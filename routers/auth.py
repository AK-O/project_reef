from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import (
    create_access_token,
    generate_api_token,
    get_current_user,
    hash_password,
    verify_password,
)
from database import get_db
from models import User
from schemas import ApiTokenOut, TokenOut, UserLogin, UserOut, UserRegister, UserUpdate

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def register(body: UserRegister, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=409, detail="Username already taken")
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=409, detail="Email already registered")

    is_first = db.query(User).count() == 0
    user = User(
        username=body.username,
        email=body.email,
        password_hash=hash_password(body.password),
        timezone=body.timezone,
        ha_notify_service=body.ha_notify_service,
        is_admin=is_first,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)
    return TokenOut(access_token=token, user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenOut)
def login(body: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == body.username).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(user.id)
    return TokenOut(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return UserOut.model_validate(current_user)


@router.patch("/me", response_model=UserOut)
def update_me(
    body: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.timezone is not None:
        current_user.timezone = body.timezone
    if body.ha_notify_service is not None:
        current_user.ha_notify_service = body.ha_notify_service
    db.commit()
    db.refresh(current_user)
    return UserOut.model_validate(current_user)


@router.get("/users", response_model=list[dict])
def list_users(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    users = db.query(User).filter(User.id != current_user.id).order_by(User.username).all()
    return [{"id": u.id, "username": u.username} for u in users]


@router.post("/token", response_model=ApiTokenOut)
def rotate_api_token(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_user.api_token = generate_api_token()
    db.commit()
    db.refresh(current_user)
    return ApiTokenOut(api_token=current_user.api_token)
