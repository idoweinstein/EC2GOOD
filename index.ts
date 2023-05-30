import express from "express";

import { SortKey, getRegions } from "./aws";
import { getFromCache, cacheEntrySize } from "./cache";
import { assert } from "console";

import fs from 'fs';
import https from 'https';

const privateKey = fs.readFileSync('sslcert/key.pem', 'utf8');
const certificate = fs.readFileSync('sslcert/cert.pem', 'utf8')
const sslCredentials = { key: privateKey, cert: certificate };


// NOTE: possible limit must be a divisor of cacheEntrySize to prevent
//       a case in which a page's content consists of more than one entry
const possibleLimits = [1, 5, 10, 20, 25, 50, 100, 125, 250, 500];
const defaultLimit = 10;

// Check if the limits divide cacheEntrySize
assert(possibleLimits.every((limit) => cacheEntrySize % limit === 0));
assert(cacheEntrySize % defaultLimit === 0);

const port = process.env.PORT || 443;

const app = express();

app.get("/", (req, res) => {
    res.send("Hi there! (now with ts)");
});

// Get available regions
app.get("/regions", async (_req, res) => {
    try {
        res.send(await getRegions());
    } catch {
        res.status(500).send();
    }

});

// Get instances by region
// URL parameters:
//  - region - the desired region in which the instances are allocated
// Query parameters (optional):
//  - sort - a key to sort the results by
//  - order - 'asc' for ascending order 'desc' for descending order.
//  - page - the page number (default is 1)
//  - limit - maximum number of results per page
app.get("/:region/instances", async (req, res) => {
    try {
        const region = req.params.region;
        let sortKey = req.query.sort;
        let ascending = (req.query.order ?? "asc") == "asc";
        let page: number = Math.floor(+(req.query.page ?? "1"));
        let limit: number = Math.floor(+(req.query.limit ?? defaultLimit));

        /* Validate page value */
        if (!(page > 0)) // Catches both non positive and NaN values
            page = 1; // default page number is 1

        /* Validate sortKey value */
        if (!sortKey || !['name', 'id', 'type', 'state', 'az', 'publicIP'].includes(sortKey as string)) {
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
            for (let i = possibleLimits.length - 2; i >= 0; --i) {
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

        /* Get the desired instances from cache. NOTE: page is 1-based */
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;

        const result = await getFromCache(
            region, sortKey as (SortKey | undefined), ascending, startIndex, endIndex);

        /* Build and return response */
        const output = {
            "sortKey": sortKey,
            "order": ascending ? "asc" : "desc",
            "page": page,
            "limit": limit,
            "instances": result
        };
        return res.send(output);
    } catch {
        res.status(500).send()
    }

});

https.createServer(sslCredentials, app).listen(port, () => {
    console.log(`Listening on port ${port}`);
});


