#!/bin/bash

PYTHONUNBUFFERED=1 python main.py &
python server.py
