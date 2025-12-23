import os
import requests

DOCKER_CLICKHOUSE_URL = os.environ.get("CLICKHOUSE_URL", "http://clickhouse:8123/")
CLICKHOUSE_USER = os.environ.get("CLICKHOUSE_USER", "nope")
CLICKHOUSE_PASSWORD = os.environ.get("CLICKHOUSE_PASSWORD", "nope")

script_dir = os.path.dirname(os.path.abspath(__file__))

sql_dir = os.path.join(script_dir, "sql")
sql_files = [f for f in os.listdir(sql_dir) if f.endswith(".sql")]

for sql_file in sql_files:
    with open(os.path.join(sql_dir, sql_file), "r") as file:
        sql_content = file.read()

        url = DOCKER_CLICKHOUSE_URL + "?query=" + sql_content
        response = requests.post(url, auth=(CLICKHOUSE_USER, CLICKHOUSE_PASSWORD), timeout=10)

        if response.status_code == 200:
            print(f"Successfully executed {sql_file}")
        else:
            if "already exists" in response.text:
                print(f"Skipping {sql_file} as it already exists")
            else:
                print(f"Error executing {sql_file}: {response.text}")
