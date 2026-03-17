Current database is using MySQL 8 on a Docker Container. In order to start up the DB and connect to it run these commands:

'''
docker-compose up -d
mysql -h 127.0.0.1 -P 3306 -u admin -padmin c2
'''