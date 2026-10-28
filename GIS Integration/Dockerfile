FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8002
ENV HOST=0.0.0.0

EXPOSE 8002

CMD ["sh", "-c", "python run.py --no-browser --host 0.0.0.0 --port ${PORT:-8002}"]
