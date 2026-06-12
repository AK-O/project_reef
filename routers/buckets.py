from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Bucket, User
from routers.projects import _assert_access, _get_project_or_404
from schemas import BucketCreate, BucketOut, BucketUpdate

router = APIRouter(tags=["buckets"])


@router.get("/api/projects/{project_id}/buckets", response_model=list[BucketOut])
def list_buckets(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(project_id, db)
    _assert_access(project, current_user)
    return project.buckets


@router.post(
    "/api/projects/{project_id}/buckets",
    response_model=BucketOut,
    status_code=status.HTTP_201_CREATED,
)
def create_bucket(
    project_id: str,
    body: BucketCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(project_id, db)
    _assert_access(project, current_user, "contributor")

    bucket = Bucket(project_id=project_id, name=body.name, position=body.position)
    db.add(bucket)
    db.commit()
    db.refresh(bucket)
    return BucketOut.model_validate(bucket)


@router.post("/api/projects/{project_id}/buckets/reorder", status_code=204)
def reorder_buckets(
    project_id: str,
    body: List[str],
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(project_id, db)
    _assert_access(project, current_user, "contributor")
    for position, bucket_id in enumerate(body):
        db.query(Bucket).filter(
            Bucket.id == bucket_id, Bucket.project_id == project_id
        ).update({"position": position})
    db.commit()


@router.patch("/api/buckets/{bucket_id}", response_model=BucketOut)
def update_bucket(
    bucket_id: str,
    body: BucketUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    bucket = db.query(Bucket).filter(Bucket.id == bucket_id).first()
    if not bucket:
        raise HTTPException(status_code=404, detail="Bucket not found")
    _assert_access(bucket.project, current_user, "contributor")

    if body.name is not None:
        bucket.name = body.name
    if body.position is not None:
        bucket.position = body.position

    db.commit()
    db.refresh(bucket)
    return BucketOut.model_validate(bucket)


@router.delete("/api/buckets/{bucket_id}", status_code=204)
def delete_bucket(
    bucket_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    bucket = db.query(Bucket).filter(Bucket.id == bucket_id).first()
    if not bucket:
        raise HTTPException(status_code=404, detail="Bucket not found")
    _assert_access(bucket.project, current_user, "contributor")

    # Move tasks to unsorted before deleting bucket
    for task in bucket.tasks:
        task.bucket_id = None

    db.delete(bucket)
    db.commit()
