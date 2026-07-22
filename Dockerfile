FROM python:3.12-slim

WORKDIR /app

COPY server.py cult.js newchonky.html chonnkylore.html ./
RUN mkdir -p /app/data

ENV HOST=0.0.0.0
ENV PORT=8787
ENV CHONKY_DATA_DIR=/app/data

EXPOSE 8787

CMD ["python3", "server.py"]
