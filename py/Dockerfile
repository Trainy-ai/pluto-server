# FROM python:3
FROM condaforge/miniforge3

# Build-time version info
ARG GIT_COMMIT="unknown"
ARG GIT_BRANCH="unknown"
ARG BUILD_TIME="unknown"
ARG SERVICE_VERSION="unknown"

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
ADD compat compat
ADD python python
ADD main.py main.py
ADD server.py server.py
ADD requirements.txt requirements.txt
ADD start.sh start.sh
RUN pip install -r requirements.txt --root-user-action ignore
RUN chmod +x start.sh

# Version info (baked in at build time)
ENV GIT_COMMIT=${GIT_COMMIT}
ENV GIT_BRANCH=${GIT_BRANCH}
ENV BUILD_TIME=${BUILD_TIME}
ENV SERVICE_VERSION=${SERVICE_VERSION}

ENTRYPOINT ["./start.sh"]
EXPOSE 3004
