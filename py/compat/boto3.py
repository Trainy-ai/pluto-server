from datetime import datetime

import boto3


class AWSClient:
    def __init__(self, access_key: str, secret_access_key: str):
        self.session = boto3.Session(
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_access_key,
        )
        self._ce = self.session.client("ce")

    def _get_cost_and_usage(
        self,
        _start: datetime,
        _end: datetime = datetime.now(),
        _granularity: str = "DAILY",
        _metrics: list[str] = ["UsageQuantity"],
        _filter: dict = {},
        _group_by: list[dict] = [],
    ):
        data = []
        for metric in _metrics:
            r = self._ce.get_cost_and_usage(
                TimePeriod={
                    "Start": _start.strftime("%Y-%m-%d"),
                    "End": _end.strftime("%Y-%m-%d"),
                },
                Granularity=_granularity,
                Metrics=[metric],
                GroupBy=_group_by,
                **({"Filter": _filter} if _filter else {}),
            )
            for period in r["ResultsByTime"]:
                time = period["TimePeriod"]["Start"]
                for group in period["Groups"]:
                    data.append(
                        [
                            time,
                            *group["Keys"],
                            metric,
                            float(group["Metrics"][metric]["Amount"]),
                        ]
                    )
        return data
