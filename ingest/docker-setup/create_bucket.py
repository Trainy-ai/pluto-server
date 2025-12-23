import argparse
from minio import Minio


def create_bucket(bucket_name):
    # Initialize MinIO client
    client = Minio(
        "minio:10000",
        access_key="minioadmin",
        secret_key="minioadminpassword",
        secure=False,
    )

    # Create bucket if it doesn't exist
    if not client.bucket_exists(bucket_name):
        client.make_bucket(bucket_name)
        print(f"Bucket '{bucket_name}' created successfully")
    else:
        print(f"Bucket '{bucket_name}' already exists")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create a MinIO bucket")
    parser.add_argument("bucket_name", help="Name of the bucket to create")
    args = parser.parse_args()

    create_bucket(args.bucket_name)
