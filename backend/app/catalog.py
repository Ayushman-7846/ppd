import csv
from functools import lru_cache
from io import StringIO
import json
from pathlib import Path

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError

from .csv_cells import spreadsheet_safe
from .lab_schemas import DIMENSIONS, DatasetDetail, DatasetInput, DatasetSummary, ItemInput, Reference, Stimulus
from .linguistics import DEFAULT_TEMPLATE
from .models import Dataset, DatasetItem, ModelSnapshot, Prompt


DATASETS = Path(__file__).resolve().parents[2] / "datasets"
BUILTIN_NAMES = {
    "ambiguity": "PP attachment cases", "recursion": "Recursive structures",
    "movement": "Movement and traces", "phonology": "Artificial sound patterns",
}


@lru_cache
def builtin(dimension):
    raw = json.loads((DATASETS / f"phase2-{dimension}.json").read_text(encoding="utf-8"))
    inputs = DatasetInput.model_validate({
        "name": BUILTIN_NAMES[dimension], "dimension": dimension, "provenance": raw["provenance"],
        "items": [{key: value for key, value in row.items() if key != "answer"} for row in raw["items"]],
    })
    return raw["version"], inputs, {item["item_key"]: item["answer"] for item in raw["items"]}


def builtin_view(dimension):
    version, content, _ = builtin(dimension)
    return DatasetDetail(id=f"builtin:{dimension}", version=version, kind="builtin",
                         item_count=len(content.items), **content.model_dump())


def add_items(db, dataset, items):
    records = [
        DatasetItem(dataset_id=dataset.id, item_key=item.item_key,
                    stimulus=item.stimulus.model_dump(mode="json"), reference=item.reference.model_dump(exclude_none=True))
        for item in items
    ]
    db.add_all(records)
    return records


def get_or_insert(db, model, criteria, values):
    statement = select(model).filter_by(**criteria)
    record = db.scalar(statement)
    if record is not None:
        return record
    insert = pg_insert if db.bind.dialect.name == "postgresql" else sqlite_insert
    db.execute(insert(model).values(**criteria, **values).on_conflict_do_nothing(index_elements=list(criteria)))
    return db.scalars(statement).one()


def dataset_record(db, owner, identifier, *, materialize=False):
    if isinstance(identifier, str) and identifier.startswith("builtin:"):
        dimension = identifier.removeprefix("builtin:")
        if dimension in DIMENSIONS:
            if not materialize:
                return builtin_view(dimension)
            version, content, _ = builtin(dimension)
            record = get_or_insert(db, Dataset, {"owner_id": owner, "name": f"@builtin:{dimension}", "version": version},
                                   {"dimension": dimension, "kind": "builtin", "provenance": content.provenance})
            # Dataset insertion and seeding commit together. Only a newly inserted version is empty.
            if db.scalar(select(DatasetItem.id).where(DatasetItem.dataset_id == record.id).limit(1)) is None:
                add_items(db, record, content.items)
                db.flush()
            return record
    if isinstance(identifier, int) or (isinstance(identifier, str) and identifier.isascii() and identifier.isdecimal()
                                      and len(identifier) <= 10):
        row = db.scalar(select(Dataset).where(Dataset.id == int(identifier), Dataset.owner_id == owner,
                                              Dataset.kind == "user", Dataset.archived.is_(False)))
        if row:
            return row
    raise HTTPException(404, "Dataset not found.")


def items_for(db, dataset_id):
    return list(db.scalars(select(DatasetItem).where(DatasetItem.dataset_id == dataset_id).order_by(DatasetItem.id)))


def item_view(record):
    return ItemInput(item_key=record.item_key, stimulus=Stimulus.model_validate(record.stimulus),
                     reference=Reference.model_validate(record.reference))


def dataset_view(db, row):
    if isinstance(row, DatasetDetail):
        return row
    items = [item_view(item) for item in items_for(db, row.id)]
    return DatasetDetail(id=row.id, name=row.name, version=row.version, dimension=row.dimension,
                         kind=row.kind, provenance=row.provenance, item_count=len(items), items=items)


def list_datasets(db, owner, dimension=None, search=""):
    query = (select(Dataset, func.count(DatasetItem.id)).outerjoin(DatasetItem)
             .where(Dataset.owner_id == owner, Dataset.kind == "user", Dataset.archived.is_(False))
             .group_by(Dataset.id).order_by(Dataset.id.desc()))
    if dimension:
        query = query.where(Dataset.dimension == dimension)
    if search:
        query = query.where(Dataset.name.icontains(search, autoescape=True))
    records = [
        DatasetSummary(id=row.id, name=row.name, version=row.version, dimension=row.dimension,
                       provenance=row.provenance, kind="user", item_count=count)
        for row, count in db.execute(query.limit(100))
    ]
    for task in DIMENSIONS:
        if (dimension is None or task == dimension) and search.casefold() in BUILTIN_NAMES[task].casefold():
            records.append(DatasetSummary.model_validate(builtin_view(task).model_dump()))
    return records


def save_dataset(db, owner, data, previous=None):
    if data.name.startswith("@"):
        raise HTTPException(422, "Dataset names starting with @ are reserved.")
    if previous and previous.dimension != data.dimension:
        raise HTTPException(422, "Select the existing task when creating a new version.")
    existing = db.scalar(select(Dataset).where(
        Dataset.owner_id == owner, Dataset.name == data.name, Dataset.archived.is_(False),
    ))
    if existing and (previous is None or existing.id != previous.id):
        raise HTTPException(409, "A dataset with this name already exists.")
    version = db.scalar(select(func.max(Dataset.version)).where(Dataset.owner_id == owner, Dataset.name == data.name)) or 0
    if previous:
        previous.archived = True
        version = max(version, previous.version)
    row = Dataset(owner_id=owner, name=data.name, version=version + 1, dimension=data.dimension,
                  provenance=data.provenance, kind="user")
    db.add(row)
    try:
        db.flush()
        add_items(db, row, data.items)
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "The dataset was edited concurrently. Reload and try again.") from None
    return row


def demo_answer(dimension, stimulus):
    _, data, outputs = builtin(dimension)
    for item in data.items:
        sample = item.stimulus
        if dimension == "phonology":
            matching = stimulus.rows == sample.rows and set(stimulus.phones_of_interest) <= set(sample.phones_of_interest)
        else:
            matching = (" ".join(sample.sentence.casefold().split()) == " ".join(stimulus.sentence.casefold().split())
                        and stimulus.category in (None, sample.category))
        if matching:
            return outputs[item.item_key]
    return None


def demo_baseline(dimension, answer):
    """Apply a documented simplification to the authored reference for teaching."""
    if dimension == "ambiguity":
        return answer | {"detected": False, "readings": answer["readings"][:1],
                         "explanation": "The demonstration baseline keeps the first parse only."}
    if dimension == "recursion":
        return {"detected": False, "tree": answer["tree"],
                "explanation": "The demonstration baseline does not propose an expansion."}
    if dimension == "movement":
        return {"detected": False, "tree": answer["tree"],
                "explanation": "The demonstration baseline does not analyze the movement dependency."}
    rule = answer["substitution"] | {"left": None, "right": None}
    return answer | {"environment": "_", "formal_rule": f"{rule['source']} → {rule['replacement']} / _",
                     "substitution": rule, "exception_ids": [],
                     "explanation": "The demonstration baseline applies the substitution without conditioning.",
                     "generalization": "The substitution is applied in every context."}


def prompt_for(db, owner, dimension, identifier=None):
    if identifier is not None:
        prompt = db.scalar(select(Prompt).where(Prompt.id == identifier, Prompt.owner_id == owner,
                                                Prompt.dimension == dimension))
        if prompt is None:
            raise HTTPException(404, "Prompt version not found for this task.")
        return prompt
    return get_or_insert(db, Prompt, {"owner_id": owner, "name": f"@default:{dimension}", "version": 1},
                         {"dimension": dimension, "template": DEFAULT_TEMPLATE})


def model_snapshot(db, provider, model):
    return get_or_insert(db, ModelSnapshot, {"provider": provider, "identifier": model}, {})


def import_csv(source, dimension):
    reader = csv.DictReader(StringIO(source, newline=""), strict=True)
    allowed = ({"item_key", "word_id", "underlying", "surface", "target", "context", "phones_of_interest", "reference"}
               if dimension == "phonology" else {"item_key", "sentence", "category", "reference"})
    required = {"item_key", "word_id", "surface"} if dimension == "phonology" else {"item_key", "sentence"}
    fields = reader.fieldnames or []
    if len(set(fields)) != len(fields) or not required <= set(fields) <= allowed:
        raise ValueError("CSV headers are invalid for the selected task.")
    items = {}
    for number, original in enumerate(reader, 2):
        if number > 7501 or None in original or any(value is None for value in original.values()):
            raise ValueError(f"CSV row {number} has an invalid column count or exceeds the row limit.")
        row = {key: value.strip() for key, value in original.items()}
        if not row["item_key"]:
            raise ValueError(f"CSV row {number} requires an item_key.")
        key = row["item_key"]
        reference = json.loads(row["reference"]) if row.get("reference") else {}
        if dimension != "phonology":
            if key in items:
                raise ValueError(f"Duplicate item key at row {number}.")
            items[key] = {"item_key": key, "stimulus": {"sentence": row["sentence"], "category": row.get("category") or None},
                          "reference": reference}
            continue
        targets = row.get("phones_of_interest", "").split()
        item = items.setdefault(key, {"item_key": key, "stimulus": {"rows": [], "phones_of_interest": targets}, "reference": reference})
        if item["reference"] != reference or item["stimulus"]["phones_of_interest"] != targets:
            raise ValueError(f"All rows of {key} must use the same reference and phones of interest.")
        item["stimulus"]["rows"].append({
            "word_id": row["word_id"], "underlying": row.get("underlying") or None, "surface": row["surface"],
            "target": row.get("target") or None, "context": row.get("context", ""),
        })
    return list(items.values())


def export_csv(dataset):
    phonology = dataset.dimension == "phonology"
    columns = (["item_key", "word_id", "underlying", "surface", "target", "context", "phones_of_interest", "reference"]
               if phonology else ["item_key", "sentence", "category", "reference"])
    output = StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns)
    writer.writeheader()

    for item in dataset.items:
        reference = json.dumps(item.reference.model_dump(exclude_none=True), ensure_ascii=False)
        if phonology:
            rows = [row.model_dump() | {"phones_of_interest": " ".join(item.stimulus.phones_of_interest)} for row in item.stimulus.rows]
        else:
            rows = [{"sentence": item.stimulus.sentence, "category": item.stimulus.category}]
        for row in rows:
            writer.writerow({name: spreadsheet_safe(value) for name, value in
                             (row | {"item_key": item.item_key, "reference": reference}).items()})
    return output.getvalue()
