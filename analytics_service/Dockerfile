FROM python:3.12-slim

WORKDIR /app

COPY analytics_service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY analytics_service /app/analytics_service

ENV PYTHONPATH=/app
EXPOSE 8000

CMD ["uvicorn", "analytics_service.app:app", "--host", "0.0.0.0", "--port", "8000"]
