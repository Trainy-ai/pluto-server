FROM locustio/locust:2.20.0

USER root

# Install git (required by mlop SDK)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Install the mlop SDK and requirements
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Copy load test files
WORKDIR /mnt/locust
COPY . /mnt/locust/

# Locust will be run with arguments passed from docker run command
