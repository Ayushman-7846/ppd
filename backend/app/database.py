from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import MetaData, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session

from .config import get_settings


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention={
        "ix": "ix_%(column_0_label)s",
        "uq": "uq_%(table_name)s_%(column_0_name)s",
        "ck": "ck_%(table_name)s_%(constraint_name)s",
        "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
        "pk": "pk_%(table_name)s",
    })


def make_engine(url: str):
    options = {"check_same_thread": False} if url.startswith("sqlite") else {"connect_timeout": 5}
    engine = create_engine(url, pool_pre_ping=True, connect_args=options)
    if engine.dialect.name == "sqlite":
        @event.listens_for(engine, "connect")
        def enable_foreign_keys(connection, _record):
            connection.execute("PRAGMA foreign_keys=ON")
    return engine


engine = make_engine(get_settings().database_url)


def get_db() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


Database = Annotated[Session, Depends(get_db)]
