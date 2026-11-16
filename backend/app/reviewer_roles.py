"""Set a research role for an existing account from the trusted server console."""
import argparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import engine
from .models import User


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("email")
    cli.add_argument("role", choices=("researcher", "reviewer", "admin"))
    args = cli.parse_args()
    with Session(engine) as db:
        user = db.scalar(select(User).where(User.email == args.email.strip().casefold()))
        if not user:
            cli.error("No account exists for that email.")
        user.role = args.role
        db.commit()
        print(f"Role updated to {args.role}.")


if __name__ == "__main__":
    main()
