# FROM python:3
FROM condaforge/miniforge3
ADD compat compat
ADD python python
ADD main.py main.py
ADD server.py server.py
ADD requirements.txt requirements.txt
ADD start.sh start.sh
RUN pip install -r requirements.txt --root-user-action ignore
RUN chmod +x start.sh
ENTRYPOINT ["./start.sh"]
EXPOSE 3004
