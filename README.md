# EC2GOOD

A Node.JS based RESTful API over HTTPS for EC2 instances.
The API offers 2 read-only request endpoints and is supported by a cache mechanism. 

## API Endpoints
The API consists of 2 endpoints:
- /regions - list available regions
- /{region}/instances - list instances in that region

### /region/
The endpoint does not receive any input.
It returns a list of available regions.
Please note that a region can be available and still not contain any instance.

Examples:
- https://server-address/region/

### /{region}/instances/
Required input (param):
- `region` - the region in which the API lists the instances
Optional inputs (query):
- `sort` - a key by which the results are sorted.<br>
   By default, the results are not sorted. <br>
   Can be only one of the following:
  - `name` - name of the machine
  - `id` - unique id of the machine
  - `type` - the EC2 machine type
  - `state` - the current state of the machine (running, stopped, etc...)
  - `az` - availability zone of the machine
- `order` - in which order the results are sorted. <br>
  Can be either `asc` or `dec`. If not specified, the default value is `asc`.
- `page` - number of page to show results from. Default is 1.
- `limit` - maximum amount of results per page. <br>
  Default is 10. Can be only one of the following:
  - 1
  - 5
  - 10
  - 20
  - 25
  - 50
  - 100
  - 125
  - 250
  - 500

Format of the response for a non sorted request:
```
{
   "order": ...,
   "page": ...,
   "limit": ...,
   "instances":[
      {
         "name": ...,
         "id": ...,
         "type": ...,
         "az": ...,
         "state": ...,
         "privateIPs":[
            ...
         ]
      }, ...
   ]
}
```

Response of a sorted request also contains the `sort` attribute.

Examples:
- https://server-address/us-west-2/instances/
- https://server-address/eu-north-1/instances/?sort=name
- https://server-address/eu-north-1/instances/?sort=id&order=desc&limit=5&page=3

## Cache
As mentioned, the API is supported by a cache.
The cache stores the data for each region using an LRU replacement policy, and works as follows:
When a new request is received, the cache checks when was the last request in that region.
If less than a minute passed, in only requests AWS SDK for the current statuses of the instances.
Otherwise, it checks if any management events has occurred (using CloudTrail) and if so updates all data.

## Installation
- Clone this repository and enter:
  ```
  git clone https://github.com/idoweinstein/EC2GOOD.git
  cd EC2GOOD
  npm i
  ```
- Create an SSL certificate, for example, in Ubuntu:
  ```
  mkdir sslcert
  openssl genrsa -out key.pem
  openssl req -new -key key.pem -out csr.pem
  openssl x509 -req -days 9999 -in csr.pem -signkey key.pem -out cert.pem
  cd ..
  ```
- Assign your AWS credentials to `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables. In Ubuntu:
  ```
  export AWS_ACCESS_KEY_ID=<your access key id>
  export AWS_SECRET_ACCESS_KEY=<your secret access key>
  ```
- Optionally, set `PORT` environment variable to set the server's port. Default is 443.
- Run the server:
  ```
  npm run start
  ```
