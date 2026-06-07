FROM alpine:3.21

RUN apk add --no-cache ca-certificates postgresql-client rclone tzdata

WORKDIR /app

COPY docker/backup/backup.sh /app/backup.sh
RUN chmod +x /app/backup.sh

CMD ["/app/backup.sh"]
