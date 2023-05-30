import { EC2Client, DescribeInstancesCommand, DescribeInstanceStatusCommand, Instance } from "@aws-sdk/client-ec2";
import { CloudTrailClient, LookupEventsCommand, LookupEventsCommandInput } from "@aws-sdk/client-cloudtrail";

export type SortKey = 'name' | 'id' | 'type' | 'state'| 'az' |'publicIP';

// Instance data as sent as response
export class Output {
    name?: string;
    id?: string;
    type?: string;
    state?: string;
    az?: string;
    publicIP?: string;
    privateIPs?: string[];

    static getCompare(sortKey: SortKey | undefined, ascending: boolean) {
        return (a: Output, b: Output) => {
            const order = ascending ? -1 : 1;
            if (a === b) return 0;

            // undefined is always last
            if (a === undefined) return 1;
            if (b === undefined) return -1;
            if (sortKey === undefined) return order;

            if (a[sortKey] === undefined && b[sortKey] === undefined) return order;
            if (a[sortKey] === undefined) return 1;
            if (b[sortKey] === undefined) return -1;

            return (a[sortKey] as string).localeCompare(b[sortKey] as string) * -order;
        }
    }
}

// Get EC2 client of @region
function getEC2Client(region: string) {
    const credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: region
    };
    return new EC2Client(credentials);
}

// Get CloudTrail client of @region
function getCloudTrailClient(region: string) {
    const credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: region
    };
    return new CloudTrailClient(credentials);
}

// Convert Instance instance to Output instance
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
    output.state = instance.State?.Name;
    output.publicIP = instance.PublicIpAddress;
    if (instance.NetworkInterfaces) {
        output.privateIPs = instance.NetworkInterfaces.map(
            item => item.PrivateIpAddress).filter(
            item => item !== undefined) as string[];
    }
    return output;
}

// Get all instances of @region in the format of Output
export async function getInstances(region: string) {
    // List of all instances
    let outputs: Output[] = [];
    // instance-id to index mapping
    let idmap = new Map<string, number>();

    try {
        const resp = await getEC2Client(region).send(new DescribeInstancesCommand({}));
        if (resp.Reservations) {
            for (const machine of resp.Reservations) {
                if (machine.Instances) {
                    for (const instance of machine.Instances) {
                        const output = processInstance(instance)
                        outputs.push(output);
                        idmap.set(output.id as string, outputs.length - 1);
                    }
                }
            }
        }
    } catch (err) {
        throw err;
    }

    return {outputs, idmap}
}

// Get statuses of all instances in @region
export async function getStatuses(region: string) {
    return await getEC2Client(region).send(new DescribeInstanceStatusCommand({
        IncludeAllInstances: true
    }));
}

// Return true if any event has occurred in @region since @startDate
export async function haveEventsOccurredSince(region: string, startDate: Date) {
    let input : LookupEventsCommandInput = {
        StartTime: startDate
    };

    const response = await getCloudTrailClient(region).send(new LookupEventsCommand(input));

    return (response?.Events?.length ?? 0) > 0;
}