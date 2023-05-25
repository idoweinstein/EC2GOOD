import express from "express";
import { EC2Client, DescribeInstancesCommand, EC2, Instance } from "@aws-sdk/client-ec2";
import * as Collections from 'typescript-collections';


class Output {
    name?: string;
    id?: string;
    mtype?: string;
    state?: string;
    az?: string;
    public_ip?: string;
    private_ips?: string[];
}

// TODO: make user decide the region
const credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: 'eu-north-1'
};

const client = new EC2Client(credentials);

const port = 7000;

const app = express();


// Cache latest unique requests
// TODO: invalidate cache when necessary
const cacheMaxSize = 100;
const cacheEntrySize = 500;
const cache = new Map<[string, boolean, number], [Output[], number]>;
let counter = 0;

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
    output.mtype = instance.InstanceType;
    output.az = instance.Placement?.AvailabilityZone;
    output.state = instance.Monitoring?.State;
    output.public_ip = instance.PublicIpAddress;
    if (instance.NetworkInterfaces) {
        output.private_ips = instance.NetworkInterfaces.map(
            item => item.PrivateIpAddress).filter(
            item => item !== undefined) as string[];
    }
    return output;
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

function updateCache(sortKey: string, ascending: boolean, baseIndex: number) {
    if (cache.has([sortKey, ascending, baseIndex]) {
        cache[[sortKey, ascending. baseIndex]] = [cache[[sortKey, ascending. baseIndex]][0], counter++];
        return;
    }

    const instances = await getAllInstances();
    // TODO: check sizes (that both baseIndex - 1 and baseIndex + cacheEntrySize do not exceed entries.length - 1
    const compare = (a: Output, b: output) => a[sortKey].localeCompare(b[sortKey]) * (ascending ? 1 : -1);
    // Get rid of elements before our elements of interest
    quickselect(instances, baseIndex - 1, 0, entries.length - 1, compare);
    // Move our elements of interest to indices [baseIndex, ..., baseIndex + cacheEntrySize]
    quickselect(instances, cacheEntrySize - 1, baseIndex, entries.length - 1, compare);
    const entry = instances.slice(baseIndex, baseIndex + cacheEntrySize).sort(compare);
    
    if (cache.length >= cacheMaxSize) {
        deleteOldestEntry();
    }
    
    cache[[sortKey, ascending, baseIndex]] = [entry, counter++];
}

function getFromCache(sortKey: string, ascending: boolean, startIndex: number, endIndex: number) {
    // Trunc number and get the base index of its entry
    const baseIndex = Math.floor(startIndex / cacheEntrySize) * cacheEntrySize;
    // TODO: assert endIndex in the same entry
    updateCache(sortKey, ascending, basedIndex);
    // TODO: assert size of entry
    const entry = cache.get([sortKey, ascending, basedIndex])[0];
    return entry.slice(startIndex - baseIndex, endIndex - baseIndex);
}

app.get("/instances", async (req, res) =>  {
    const sortKey = req.query.sort; // TODO: validate the key is sortable
    const ascending = (req.query.order ?? "asc") == "asc"; // TODO: validate the key is ascending or descending
    const page : number = +(req.query.page ?? "1"); // TODO: validate the page is an integer
    const limit : number = +(req.query.limit ?? "10"); // TODO: assert limit is in [1,5,10,20,25,50,100]
    
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    
    for (

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
        res.status(500)
        res.render('error', {error: err})
        throw err;
    }

    quickselect(outputs, limit * page, )
    return res.send(outputs);
});


app.listen(port, () => {
    console.log(`Listening on port ${port}`);
});
