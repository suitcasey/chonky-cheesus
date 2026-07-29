FROM python:3.12-slim

WORKDIR /app

COPY server.py \
     cult.js \
     keeper.js \
     config.js \
     contract-strip.js \
     index.html \
     newchonky.html \
     chonnkylore.html \
     profile.html \
     favicon.svg \
     og-image.png \
     ./
RUN mkdir -p /app/data

ENV HOST=0.0.0.0
ENV PORT=8787
ENV CHONKY_DATA_DIR=/app/data

EXPOSE 8787

CMD ["python3", "server.py"]
