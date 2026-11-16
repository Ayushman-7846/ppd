from alembic import context

from app import evaluation_models, models
from app.config import get_settings
from app.database import Base, engine


if context.is_offline_mode():
    context.configure(url=get_settings().database_url, target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    with engine.connect() as connection:
        sqlite = connection.dialect.name == "sqlite"
        if sqlite:
            # Batch migrations rebuild tables that already have inbound foreign keys.
            # Begin explicitly so SQLite DDL and the integrity check are atomic.
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            connection.exec_driver_sql("BEGIN")
        context.configure(connection=connection, target_metadata=Base.metadata)
        try:
            with context.begin_transaction():
                context.run_migrations()
            if sqlite:
                if connection.exec_driver_sql("PRAGMA foreign_key_check").first() is not None:
                    raise RuntimeError("Migration left invalid SQLite foreign keys.")
                connection.commit()
        finally:
            if sqlite:
                connection.rollback()
                connection.exec_driver_sql("PRAGMA foreign_keys=ON")
