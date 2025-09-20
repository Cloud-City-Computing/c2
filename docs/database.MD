Current database is using PostgreSQL on a Docker Container. In order to start up the DB and connect to it run these commands:

'''
docker-compose up -d
psql -h localhost -p 15432 -U admin -d codex_db
'''