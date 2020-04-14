const variantsAPI = 'https://cfw-takehome.developers.workers.dev/api/variants'

function getURLWeights(urls) {
    return urls.map(() => 50) // 50/50 chance
}

function selectURL(urls) {
    let weights = getURLWeights(urls)
    let weightSum = weights.reduce((accumulator, weight) => accumulator + weight, 0)
    let rand = Math.random() * weightSum
    // normalized weight
    let accumulator = 0
    weights = weights.map(weight => (accumulator = accumulator + weight))
    return urls[weights.findIndex(prob => prob > rand)]
}

async function getVariantsURL() {
    let variantsResp = await fetch(variantsAPI)
    let variantsJson = await variantsResp.json()
    return variantsJson.variants
}

async function getResponseStream(url) {
    // https://developers.cloudflare.com/workers/reference/apis/streams/#streaming-passthrough
    let response = await fetch(url)
    let { readable, writable } = new TransformStream()
    response.body.pipeTo(writable)
    return new Response(readable, response)
}

/**
 * Respond with hello worker text
 * @param {Request} request
 */
async function handleRequest(request) {
    let urls = await getVariantsURL()
    let url = selectURL(urls)
    return getResponseStream(url)
}

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request))
})
