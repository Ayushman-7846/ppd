from datetime import datetime, timedelta, timezone
from hashlib import sha256
from secrets import token_urlsafe
from time import time
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from sqlalchemy import case, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError

from .config import get_settings
from .database import Database
from .models import AuthenticationQuota, SessionToken, User
from .schemas import Credentials, Envelope, Profile, Registration


COOKIE = "lingualens_session"
SESSION_TTL = timedelta(days=7)
hasher = PasswordHasher()
dummy_hash = hasher.hash(token_urlsafe(32))
SessionCookie = Annotated[str | None, Cookie(alias=COOKIE)]


def same_origin(request: Request):
    origin = request.headers.get("origin")
    if origin != get_settings().web_origin.rstrip("/"):
        raise HTTPException(403, "The request origin is not allowed.")


def digest(token: str) -> str:
    return sha256(token.encode()).hexdigest()


def authentication_quota(db, scopes):
    window = int(time() // 60)
    insert = pg_insert if db.bind.dialect.name == "postgresql" else sqlite_insert
    for scope, limit in scopes:
        statement = insert(AuthenticationQuota).values(key=digest(scope), window=window, used=1)
        statement = statement.on_conflict_do_update(index_elements=["key"], set_={
            "window": window, "used": case((AuthenticationQuota.window == window, AuthenticationQuota.used + 1), else_=1),
        }, where=or_(AuthenticationQuota.window != window, AuthenticationQuota.used < limit)).returning(AuthenticationQuota.used)
        if db.scalar(statement) is None:
            db.commit()
            raise HTTPException(429, "Too many authentication attempts. Retry in a minute.", headers={"Retry-After": "60"})
    db.commit()


def require_user(db: Database, token: SessionCookie = None) -> User:
    if token:
        user = db.scalar(select(User).join(SessionToken).where(
            SessionToken.digest == digest(token), SessionToken.expires_at > func.now()
        ))
        if user:
            return user
    raise HTTPException(401, "Sign in to access the research workspace.")


CurrentUser = Annotated[User, Depends(require_user)]
router = APIRouter(prefix="/auth", tags=["Authentication"])
write_route = [Depends(same_origin)]


def issue_session(db: Database, response: Response, user: User, previous: str | None):
    token = token_urlsafe(32)
    if previous:
        db.execute(delete(SessionToken).where(SessionToken.digest == digest(previous)))
    db.add(SessionToken(
        digest=digest(token), user_id=user.id,
        expires_at=datetime.now(timezone.utc) + SESSION_TTL,
    ))
    profile = Profile.model_validate(user)
    db.commit()
    response.set_cookie(
        COOKIE, token, httponly=True, secure=get_settings().secure_cookie,
        samesite="lax", max_age=int(SESSION_TTL.total_seconds()),
    )
    return Envelope(data=profile)


@router.post("/register", response_model=Envelope[Profile], status_code=201, dependencies=write_route)
def register(data: Registration, db: Database, request: Request, response: Response, token: SessionCookie = None):
    if not get_settings().registration_enabled:
        raise HTTPException(403, "New registrations are closed for this workspace.")
    peer = request.client.host if request.client else "unknown"
    authentication_quota(db, [(f"register:{peer}", 15)])
    user = User(email=data.email.casefold(), name=data.name, password_hash=hasher.hash(data.password))
    db.add(user)
    try:
        db.flush()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "This email address is already registered.") from error
    return issue_session(db, response, user, token)


@router.post("/login", response_model=Envelope[Profile], dependencies=write_route)
def login(data: Credentials, db: Database, request: Request, response: Response, token: SessionCookie = None):
    peer = request.client.host if request.client else "unknown"
    authentication_quota(db, [(f"login-peer:{peer}", 60), (f"login-email:{data.email.casefold()}", 10)])
    user = db.scalar(select(User).where(User.email == data.email.casefold()))
    try:
        hasher.verify(user.password_hash if user else dummy_hash, data.password)
    except VerifyMismatchError:
        raise HTTPException(401, "The email or password is incorrect.") from None
    if user is None:
        raise HTTPException(401, "The email or password is incorrect.")
    if hasher.check_needs_rehash(user.password_hash):
        user.password_hash = hasher.hash(data.password)
    return issue_session(db, response, user, token)


@router.get("/me", response_model=Envelope[Profile])
def profile(user: CurrentUser):
    return Envelope(data=Profile.model_validate(user))


@router.post("/logout", response_model=Envelope[dict], dependencies=write_route)
def logout(db: Database, response: Response, token: SessionCookie = None):
    if token:
        db.execute(delete(SessionToken).where(SessionToken.digest == digest(token)))
        db.commit()
    response.delete_cookie(COOKIE, httponly=True, secure=get_settings().secure_cookie, samesite="lax")
    return Envelope(data={"signed_out": True})
