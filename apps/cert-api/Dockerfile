FROM python:3.12-slim

WORKDIR /app

# Install system deps: freetds for SQL Server, libaio for Oracle Instant Client
RUN apt-get update && apt-get install -y --no-install-recommends \
    freetds-dev libaio1t64 curl unzip \
    && ln -sf /usr/lib/x86_64-linux-gnu/libaio.so.1t64 /usr/lib/x86_64-linux-gnu/libaio.so.1 \
    && rm -rf /var/lib/apt/lists/*

# Install Oracle Instant Client 23 (Basic Lite)
RUN curl -fsSL https://download.oracle.com/otn_software/linux/instantclient/2370000/instantclient-basiclite-linux.x64-23.7.0.25.01.zip -o /tmp/ic.zip \
    && unzip -q /tmp/ic.zip -d /opt/oracle \
    && rm /tmp/ic.zip \
    && sh -c 'echo /opt/oracle/instantclient_23_7 > /etc/ld.so.conf.d/oracle.conf' \
    && ldconfig

ENV LD_LIBRARY_PATH=/opt/oracle/instantclient_23_7

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p reports

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
