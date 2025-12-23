import base64
import datetime
import json
import logging
import os
import shutil
import uuid

import mlop
import requests
import urllib3
from gql import Client, gql
from gql.transport.requests import RequestsHTTPTransport
from mlop.api import make_compat_message_v1
from requests.auth import HTTPBasicAuth

from .w import _WClient

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

max_int = 2**31 - 1
tmp = ".tmp"


def get_client(key, domain=None, **kwargs):
    transport = RequestsHTTPTransport(
        url=f"https://api.{domain}/graphql",
        auth=HTTPBasicAuth("api", key),
        headers={
            "Host": f"api.{domain}",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
            "Use-Admin-Privileges": "true",  # custom
            "Origin": f"https://{domain}",
            "Accept": "*/*",
            # **auth,
        },
        **kwargs,
    )
    client = Client(transport=transport)
    return _WClient(client)


def list_runs(c, entity):
    res = c.projects(entity=entity, per_page=max_int)["models"]["edges"]
    for p in res:
        project_name = p["node"]["name"]
        p["node"]["runs"] = c.runs(project=project_name, entity=entity)["project"][
            "runs"
        ]["edges"]
    return res


def download_file(file, url=None):
    file = os.path.dirname(file) + "/" + str(uuid.uuid4()) + os.path.basename(file)
    if url:
        os.makedirs(os.path.dirname(file), exist_ok=True)
        with open(file, "wb") as f:
            f.write(requests.get(url).content)

    if os.path.exists(file):
        return file
    return None


def get_file_url(c, f, name, entity, project_name, run_name):
    for e in f:
        if e["node"]["name"] == name:
            return e["node"]["directUrl"]
    # print("File not found in cached list:", name)
    try:
        url = c.direct_url_query(
            project_name=project_name,
            entity_name=entity,
            run_name=run_name,
            filenames=[f"{name}"],
        )["project"]["run"]["files"]["edges"][0]["node"]["directUrl"]
        if url:
            return url
    except Exception as e:
        print(e)
    print("File not found:", name)
    return None


def parse_type(c, f, v, entity, project_name, run_name):
    type = v.get("_type")
    if type:
        if type == "image-file":
            path = v.get("path")
            url = get_file_url(
                c,
                f,
                name=path,
                entity=entity,
                project_name=project_name,
                run_name=run_name,
            )
            local = download_file(f"{tmp}/{path}", url)
            if local:
                e = mlop.Image(data=local, caption=v.get("caption"))
        elif type == "images/separated":
            e = []
            for i in range(len(v.get("filenames"))):
                path = v.get("filenames")[i]
                url = get_file_url(
                    c,
                    f,
                    name=path,
                    entity=entity,
                    project_name=project_name,
                    run_name=run_name,
                )
                local = download_file(f"{tmp}/{path}", url)
                if local:
                    e.append(mlop.Image(data=local, caption=v.get("captions")[i]))
        elif type == "audio-file":
            path = v.get("path")
            url = get_file_url(
                c,
                f,
                name=path,
                entity=entity,
                project_name=project_name,
                run_name=run_name,
            )
            local = download_file(f"{tmp}/{path}", url)
            if local:
                e = mlop.Audio(data=local, caption=v.get("caption"))
        elif type == "audio":
            e = []
            for i in range(len(v.get("audio"))):
                e.append(
                    parse_type(c, f, v.get("audio")[i], entity, project_name, run_name)
                )
        elif type == "video-file":
            path = v.get("path")
            url = get_file_url(
                c,
                f,
                name=path,
                entity=entity,
                project_name=project_name,
                run_name=run_name,
            )
            local = download_file(f"{tmp}/{path}", url)
            if local:
                e = mlop.Video(data=local, caption=v.get("caption"))
        elif type == "videos":
            e = []
            for i in range(len(v.get("videos"))):
                e.append(
                    parse_type(c, f, v.get("videos")[i], entity, project_name, run_name)
                )
        elif type == "histogram":
            return None
            if v.get("packedBins"):
                bins = v.get("packedBins")
                bins = [bins["min"] + bins["size"] * i for i in range(bins["count"])]
            else:
                bins = v.get("bins")
            data = [
                list(v.get("values")),
                bins,
            ]
            e = mlop.Histogram(data=data)
        else:
            print("Unknown type:", v)
            return None
        return e
    else:
        return None


def get_settings(auth, c, r):
    settings = mlop.Settings()
    settings._sys = mlop.System(settings)
    settings._sys.monitor = lambda: {}
    settings._auth = auth

    config = json.loads(r["config"])
    info = {k: v for k, v in r["runInfo"].items()}
    settings._sys.get_info = lambda: info
    for i in ("config", "runInfo", "summaryMetrics"):  # "historyKeys"
        r.pop(i) if i in r else None
    settings.compat = {
        (k if k != "heartbeatAt" else "updatedAt"): v for k, v in r.items()
    }
    settings.compat["createdAt"] = int(
        datetime.datetime.strptime(
            settings.compat["createdAt"], "%Y-%m-%dT%H:%M:%SZ"
        ).timestamp()
    )
    settings.compat["updatedAt"] = int(
        datetime.datetime.strptime(
            settings.compat["updatedAt"], "%Y-%m-%dT%H:%M:%SZ"
        ).timestamp()
    )
    settings.compat["viewer"] = c.viewer()["viewer"]

    return settings, config, r["displayName"]


def get_logs(logs, op):
    for e in logs:
        op.settings.message.put(
            make_compat_message_v1(
                logging._nameToLevel[e["node"]["level"].upper()],
                e["node"]["line"],
                datetime.datetime.strptime(
                    e["node"]["timestamp"], "%Y-%m-%dT%H:%M:%S.%f"
                ).timestamp(),
                int(e["node"]["id"]),
            )
        )


def get_sys(sys, op):
    for i in range(len(sys)):
        line = json.loads(sys[i])
        step = i + 1
        timestamp = line["_timestamp"]
        for k, v in line.items():
            if not k.startswith("_") and isinstance(v, (int, float)):
                op._log(
                    data={k.replace("system.", "sys/"): v},
                    step=step,
                    t=timestamp,
                )


def migrate_run_v1(auth, c, entity, project_name, run_name):
    print(f"Migrating {entity}/{project_name}/{run_name}...")

    # TODO: remove max_int dependency
    try:
        f = c.run_files(
            project=project_name, entity=entity, name=run_name, file_limit=max_int
        )["project"]["run"]["files"]["edges"]
    except Exception as e:
        print("Error fetching run files:", e)
        return None

    r = c.run(project_name=project_name, entity_name=entity, run_name=run_name)[
        "project"
    ]["run"]
    hkeys = [
        h for h in r["historyKeys"]["keys"]
    ]  # list(r['historyKeys']['keys'].keys())

    settings, config, name = get_settings(auth, c, r)

    op = mlop.init(
        dir=tmp,
        project=project_name,
        name=name,
        config=config,
        settings=settings,
    )

    def get_history(h, op):
        for i in h:
            for d in i:
                step = d["_step"]
                timestamp = float(d["_timestamp"])
                for k, v in d.items():
                    if not k.startswith("_"):
                        e = None
                        if isinstance(v, dict):  # non-metrics
                            e = parse_type(c, f, v, entity, project_name, run_name)
                        elif isinstance(v, (int, float)):
                            e = v
                        op._log(data={k: e}, step=step, t=timestamp) if e else None

    try:
        get_sys(
            sys=c.run_system_metrics(
                project_name=project_name,
                entity_name=entity,
                run_name=run_name,
            )["project"]["run"]["events"],
            op=op,
        )
        get_logs(
            logs=c.run_log_lines(
                project_name=project_name,
                entity_name=entity,
                run_name=run_name,
            )["project"]["run"]["logLines"]["edges"],
            op=op,
        )
        for i in range(0, len(hkeys), 4):
            batch_hkeys = hkeys[i : i + 4]
            if not batch_hkeys:
                continue
            state = c.run_state_delta_query(
                project_name=project_name,
                entity_name=entity,
                filters=json.dumps({"name": run_name}),
                sampled_history_specs=[
                    json.dumps(
                        {
                            "keys": ["_step", "_timestamp", e],
                            "samples": max_int,
                        }
                    )
                    for e in batch_hkeys
                ],
                enable_history_key_info=False,
                enable_sampled_history=True,
                enable_system_metrics=False,
                limit=max_int,
            )
            batch_history_data = state["project"]["runs"]["delta"][0]["run"][
                "sampledHistory"
            ]
            get_history(batch_history_data, op)

        op.finish()
        return True
    except Exception as e:
        print(e)
        op.finish()
        return None


def migrate_all(auth, key, entity, domain=None):
    c = get_client(key, domain)
    try:
        projects = c.projects(entity=entity, per_page=max_int)["models"]["edges"]
        for p in projects:
            project_name = p["node"]["name"]
            runs = c.runs(project=project_name, entity=entity)["project"]["runs"][
                "edges"
            ]
            for r in runs:
                run_name = r["node"]["name"]
                migrate_run_v1(auth, c, entity, project_name, run_name)
                if os.path.exists(tmp):
                    shutil.rmtree(tmp)
        return True
    except Exception as e:
        print("Error migrating:", e)
        return None


if __name__ == "__main__":
    auth = input("Enter mlop auth: ")
    key = input("Enter w api key: ")
    entity = input("Enter w entity: ")
    migrate_all(auth, key, entity, os.getenv("W_DOMAIN"))


### DEPRECATED


def migrate_run_v0(auth, c, entity, project_name, run_name):
    print("Migrating:", entity, project_name, run_name)

    # TODO: remove max_int dependency
    try:
        f = c.run_files(
            project=project_name, entity=entity, name=run_name, file_limit=max_int
        )["project"]["run"]["files"]["edges"]
        h = c.run_full_history(
            project=project_name, entity=entity, name=run_name, samples=max_int
        )["project"]["run"]["history"]
    except Exception as e:
        print("Error fetching run files or history:", e)
        return None

    r = c.run(project_name=project_name, entity_name=entity, run_name=run_name)[
        "project"
    ]["run"]
    settings, config, name = get_settings(auth, c, r)

    op = mlop.init(
        dir=tmp,
        project=project_name,
        name=name,
        config=config,
        settings=settings,
    )
    try:
        for d in h:
            d = json.loads(d)  # TODO: cleanup before parsing
            step = int(d["_step"])
            timestamp = float(d["_timestamp"])
            for k, v in d.items():
                if not k.startswith("_"):
                    e = None
                    if isinstance(v, dict):  # non-metrics
                        e = parse_type(c, f, v, entity, project_name, run_name)
                    elif isinstance(v, (int, float)):
                        e = v
                    op._log(data={k: e}, step=step, t=timestamp) if e else None
        op.finish()
        return True
    except Exception as e:
        print(e)
        op.finish()
        return None
