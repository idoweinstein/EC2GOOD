
import { Mutex } from 'async-mutex';
// @ts-ignore
import quickselect from  "quickselect";

import {Output, getInstances, getStatuses, haveEventsOccurredSince, SortKey} from './aws';

// An entry in the LRU cache
class CacheEntry {
    instances : Output[];

    static _new_seq = 0;
    sequence : number;

    constructor(ins: Output[]) {
        this.instances = ins;
        this.sequence = CacheEntry._new_seq++;
    }

    updateSequence() {
        this.sequence = CacheEntry._new_seq++;
    }
}

// An LRU cache of a region, storing a batch of instances
class LRURegionCache {
    private cache = new Map<[SortKey | undefined, boolean, number], CacheEntry>();
    private size : number;

    constructor(size: number) {
        this.size = size;
    }

    private deleteOldest() {
        let oldestSequence = Number.MAX_VALUE;
        let selectedKey = undefined;
        if (this.cache.size == 0) {
            return;
        }
    
        // Look for the oldest entry
        for (const [key, entry] of this.cache) {
            if (entry.sequence <= oldestSequence) {
                oldestSequence = entry.sequence;
                selectedKey = key;
            }
        }
    
        if (selectedKey) {
            this.cache.delete(selectedKey);
        }
    }

    has(key: [SortKey | undefined, boolean, number]) {
        return this.cache.has(key);
    }

    get(key: [SortKey | undefined, boolean, number]) {
        const entry = this.cache.get(key);
        if (entry) {
            entry.updateSequence();
        }
        return entry?.instances;
    }

    set(key: [SortKey | undefined, boolean, number], instances: Output[]) {
        if (this.cache.size >= this.size) {
            this.deleteOldest();
        }
        const entry = new CacheEntry(instances);
        this.cache.set(key, entry);
    }

    isEmpty() {
        return this.cache.size === 0;
    }

    clear() {
        this.cache.clear();
    }
}

// All of the cached information about instances in a region
class RegionData {
    instances : Output[] = [];
    id_to_index = new Map<string, number>();

    lastValidityCheck : Date = new Date(0);
    lastStatusCheck : Date = new Date();

    // Cache which stores entries to be fetched immediately
    pageCache = new LRURegionCache(cacheMaxSize);
}

// Cache latest unique requests
export const cacheEntrySize = 500;
const cacheMaxSize = 100;
const cacheTTL = 60 * 1000; // cache entry TTL is 60 seconds

const mutex = new Mutex();
const regionsData = new Map<string, RegionData>();

// Update the cached data of all instances in @region
async function updateAllInstances(region: string) {
    if (!regionsData.has(region)) {
        regionsData.set(region, new RegionData());
    }

    const {outputs, idmap} : {outputs: Output[], idmap: Map<string, number>} = await getInstances(region);

    const regionData = regionsData.get(region) as RegionData;
    regionData.instances = outputs;
    regionData.id_to_index = idmap;
}

// Update the statuses of all instances in @region
async function updateAllStatuses(region: string) {
    try {
        if (!regionsData.has(region)) {
            regionsData.set(region, new RegionData());
        }
        const regionData = regionsData.get(region) as RegionData;

        regionData.lastValidityCheck = new Date();
        const resp = await getStatuses(region);

        if (resp.InstanceStatuses) {
            for (const instanceStatus of resp.InstanceStatuses) {
                if (!instanceStatus.InstanceId) continue;
                const id = instanceStatus.InstanceId;
                if (regionData.id_to_index.has(id)) {
                    const instance = regionData.instances[regionData.id_to_index.get(id) as number];
                    instance.state = instanceStatus.InstanceState?.Name;
                }
            }
        }
    } catch (err) {
        throw err;
    }
}

// Make the cached data of @region valid
async function validateCache(region: string) {
    return await mutex.runExclusive(async () => {
        // TODO: maybe monitor just events related to instances creation/deletion/run/stop/data change
        if (!regionsData.has(region) || !(regionsData.get(region)?.instances.length)) {
            await updateAllInstances(region);
        }

        const regionData = regionsData.get(region) as RegionData;

        if (regionData.pageCache.isEmpty()) {
            return;
        }

        let startTime = regionData.lastValidityCheck;

        const now = new Date();
        // Monitor every minute
        if ((now.getTime() - regionData.lastValidityCheck.getTime()) < cacheTTL) {
            await updateAllStatuses(region);
            return;
        }

        if (await haveEventsOccurredSince(region, startTime)) {
            // Event happened, regenerate cache
            await updateAllInstances(region);
        } else {
            // Update statuses only
            await updateAllStatuses(region);
        }
    });

}

// Update cached data relevant to the requested instances
async function updateCache(region: string, sortKey: SortKey | undefined,
                           ascending: boolean, baseIndex: number) {
    await validateCache(region);
    const regionData = regionsData.get(region) as RegionData;
    const instances = regionData.pageCache.get([sortKey, ascending, baseIndex]);

    if (instances) {
        return instances;
    }

    // Shallow copy the instances' data
    const instancesDup = [...regionData.instances];
    const compare = Output.getCompare(sortKey, ascending);

    // Get rid of elements before our elements of interest
    if (baseIndex > 0)
        quickselect(instancesDup, baseIndex - 1, 0, instancesDup.length - 1, compare);

    // Move our elements of interest to indices [baseIndex, ..., baseIndex + cacheEntrySize - 1]
    if (instancesDup.length > cacheEntrySize) 
        quickselect(instancesDup, cacheEntrySize - 1, baseIndex, instancesDup.length - 1, compare);

    const newentry = instancesDup.slice(baseIndex, baseIndex + cacheEntrySize).sort(compare);

    regionData.pageCache.set([sortKey, ascending, baseIndex], newentry)

    return newentry;
}

// Get instances in the range of [startIndex, ..., endIndex] from cache, by region, sort key, and order
export async function getFromCache(
        region: string, sortKey: SortKey | undefined,
        ascending: boolean, startIndex: number, endIndex: number) {
    // Trunc number and get the base index of its entry
    const baseIndex = Math.floor(startIndex / cacheEntrySize) * cacheEntrySize;

    // Get entry from cache
    const entry = await updateCache(region, sortKey, ascending, baseIndex);

    // Extract desired items from entry
    return entry.slice(startIndex - baseIndex, endIndex - baseIndex);
}