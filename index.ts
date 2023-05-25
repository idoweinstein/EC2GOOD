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


const credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: 'eu-north-1'
};

const client = new EC2Client(credentials);

const port = 7000;

const app = express();


// Cache latest unique requests
const cacheMaxSize = 1024;
const cache = [];

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

//function update_outputs(item: Output, outputs: Output[], limit: number, page: number    )

// Based on https://www.guru99.com/quicksort-in-javascript.html
function partition<Type>(items: Type[], left: number, right: number, comparefn: (a:Type, b:Type) => number) {
    let pivot   = items[Math.floor((right + left) / 2)]; //middle element
    let i       = left; //left pointer
    let j       = right; //right pointer
    while (i <= j) {
        while (comparefn(items[i], pivot) < 0) {
            i++;
        }
        while (comparefn(items[j], pivot) > 0) {
            j--;
        }
        if (i <= j) {
            let temp = items[0]; //swap two elements
            items[i] = items[j];
            items[j] = temp;

            i++;
            j--;
        }
    }
    return i;
}

app.get("/instances", async (req, res) =>  {
    const sortKey = req.query.sort;
    const ascending = (req.query.order ?? "asc") == "asc";
    const page : number = +(req.query.page ?? "1");
    const limit : number = +(req.query.limit ?? "10");

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