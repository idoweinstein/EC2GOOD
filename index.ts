import express from "express";
import { EC2Client, DescribeInstancesCommand, EC2, Instance } from "@aws-sdk/client-ec2";
import { CloudTrailClient, LookupEventsCommand } from "@aws-sdk/client-cloudtrail"
import * as Collections from 'typescript-collections';
import { Mutex } from 'async-mutex';

/* TODO: separate into multiple files */
/* TODO: document */

class Output {
    name?: string;
    id?: string;
    type?: string;
    state?: string;
    az?: string;
    publicIP?: string;
    privateIPs?: string[];
}

const sortableKeys = Set<string>(['name', 'id', 'type', 'state', 'az', 'publicIP']);

// Cache latest unique requests
const cacheMaxSize = 100;
const cacheEntrySize = 500;
// NOTE: possible limit must be a divisor of cacheEntrySize to prevent
//       a case in which a page's content consists of more than one entry
const possibleLimits = [1, 5, 10, 20, 25, 50, 100, 125, 250, 500];
const defaultLimit = 10;

// TODO: make user decide the region
const credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: 'eu-north-1'
};

const client = new EC2Client(credentials);

const port = 7000;

const app = express();

let instances = [];
const cache = new Map<[string, boolean, number], [Output[], number]>;
let counter = 0;
const cacheTTL = 60 * 1000; // cache entry TTL is 60 seconds
let lastValidityCheck = Date.now();

app.get("/", (req, res) => {
    res.send("Hi there! (now with ts)");
});

function processInstance(instance: Instance) {
    let output: Output = new Output();
    if (instance.Tags) {
        for (const tag of instance.Tags) {
            if (tag?.Key === "Name") {
                output.name = tag?.Value
            }
        }
    }
    output.id = instance.InstanceId;
    output.type = instance.InstanceType;
    output.az = instance.Placement?.AvailabilityZone;
    output.state = instance.Monitoring?.State;
    output.publicIP = instance.PublicIpAddress;
    if (instance.NetworkInterfaces) {
        output.privateIPs = instance.NetworkInterfaces.map(
            item => item.PrivateIpAddress).filter(
            item => item !== undefined) as string[];
    }
    return output;
}

async function validateCache() {
    await mutex.runExclusive(async () => {
        // TODO: handle a case in which multiple zones can be monitored
        // TODO: maybe monitor just events related to instances creation/deletion/run/stop/data change
        // TODO: consider updating data instead of clearing the cache
        if (cache.length == 0) {
            return;
        }
        const client = new CloudTrailClient(config);
        let input = {
            StartTime: lastValidityCheck,
        };
    
        const now = Date.now();
        // Monitor every minute
        if ((now - lastValidityCheck) < cacheTTL) {
            return;
        }

        const response = client.send(new LookupEventsCommand(input));
        lastValidityCheck = now;
    
        if (response.?Events.length > 0) {
            // Events happened, invalidate cache
            cache.clear();
            instances = await getAllInstances();
        }
    });

}

async function getAllInstances() {
    let outputs: Output[] = [];
    try {
        const resp = await client.send(new DescribeInstancesCommand({}));
        
        if (resp.Reservations) {
            for (const machine of resp.Reservations) {
                if (machine.Instances) {
                    for (const instance of machine.Instances) {
                        outputs.push(processInstance(instance));
                    }
                }
            }
        }
    } catch (err) {
        throw err;
    }
    return output;
}

function deleteOldestEntry() {
    let smallestValue = Number.MAX_VALUE;
    let selectedKey = undefined;
    for (const key in cache) {
        if (cache[key][1] < smallestValue) {
            smallestValue = cache[key][1];
            selectedKey = key;
        }
    }; 
    if (selectedKey) {
        map.delete(key);
    }
}

async function updateCache(sortKey: string, ascending: boolean, baseIndex: number) {
    await validateCache();

    if (cache.has([sortKey, ascending, baseIndex]) {
        cache[[sortKey, ascending. baseIndex]] = [cache[[sortKey, ascending, baseIndex]][0], counter++];
        return;
    }
    
    // TODO: check sizes (that both baseIndex - 1 and baseIndex + cacheEntrySize do not exceed entries.length - 1
    const compare = (a: Output, b: output) => sortKey ? (a[sortKey].localeCompare(b[sortKey]) * (ascending ? 1 : -1)) : a;
    // Shallow copy the instances' data
    const instancesDup = [...instances];
    // Get rid of elements before our elements of interest
    quickselect(instancesDup, baseIndex - 1, 0, entries.length - 1, compare);
    // Move our elements of interest to indices [baseIndex, ..., baseIndex + cacheEntrySize - 1]
    quickselect(instancesDup, cacheEntrySize - 1, baseIndex, entries.length - 1, compare);
    const entry = instancesDup.slice(baseIndex, baseIndex + cacheEntrySize).sort(compare);
    
    if (cache.length >= cacheMaxSize) {
        deleteOldestEntry();
    }
    
    cache[[sortKey, ascending, baseIndex]] = [entry, counter++];
    return entry
}

async function getFromCache(sortKey: string, ascending: boolean, startIndex: number, endIndex: number) {
    // Trunc number and get the base index of its entry
    const baseIndex = Math.floor(startIndex / cacheEntrySize) * cacheEntrySize;
    // TODO: assert endIndex in the same entry
    // TODO: assert size of entry
    
    const entry = await updateCache(sortKey, ascending, basedIndex);
    return entry.slice(startIndex - baseIndex, endIndex - baseIndex);
}

app.get("/instances", async (req, res) =>  {
    let sortKey = req.query.sort;
    let ascending = (req.query.order ?? "asc") == "asc";
    let page : number = Math.floor(+(req.query.page ?? "1"));
    let limit : number = Math.floor(+(req.query.limit ?? defaultLimit));
    
    /* Validate page value */
    if (!(page > 0)) // Catches both non positive and NaN values
        page = 1; // default page number is 1
    
    /* Validate sortKey value */
    if (!sortKey || !sortableKeys.has(sortKey)) {
        sortKey = undefined;
        ascending = true;
    }
        
    /* Validate limit value - if doesn't match, round down to a matching limit */
    if (!(limit > 0))
        limit = defaultLimit;
    else if (limit >= possibleLimits[possibleLimits.length - 1])
        limit = possibleLimits[possibleLimits.length - 1];
    else {
        let found = false;
        for (int i = possibleLimits.length - 2; i >= 0; --i) {
            if (limit >= possibleLimits[i]) {
                limit = possibleLimits[i];
                found = true;
                break;
            }
        }
        
        if (!found) {
            limit = defaultLimit;
        }
    }

    /* Get the desired instances from cache */
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const result = await getFromCache(sortKey, ascending, startIndex, endIndex);
    
    /* Build and return response */
    const output = {"sortKey": sortKey,
                    "order": "asc" if ascending else "desc",
                    "page": page,
                    "limit": limit,
                    "instances": result};
    return res.send(sortKey);
});


app.listen(port, () => {
    console.log(`Listening on port ${port}`);
});

