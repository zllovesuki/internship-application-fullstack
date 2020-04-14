// where to get out URLs
const variantsAPI = 'https://cfw-takehome.developers.workers.dev/api/variants'
// regular expression to get out cookie
const variantCookieName = 'variant'
const cookieRe = new RegExp('[; ]' + variantCookieName + '=([^\\s;]*)')

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

async function getResponseStream(url, injectCookie) {
    // https://developers.cloudflare.com/workers/reference/apis/streams/#streaming-passthrough
    let response = await fetch(url)
    let { readable, writable } = new TransformStream()
    response.body.pipeTo(writable)
    let variantResponse = new Response(readable, response)
    if (injectCookie) {
        variantResponse.headers.append('Set-Cookie', `${variantCookieName}=${url}; path=/`)
    }
    return variantResponse
}

function getVariantFromCookie(cookieString) {
    let cookieMatch = cookieString.match(cookieRe)
    if (cookieMatch) {
        return cookieMatch[1]
    }
    return null
}

/**
 * Respond with hello worker text
 * @param {Request} request
 */
async function handleRequest(request) {
    // A/B Testing cookie: https://developers.cloudflare.com/workers/templates/#ab_testing
    let variantURL = null;
    let injectVariantCookie = false
    const cookie = request.headers.get('cookie')
    if (cookie) {
        variantURL = getVariantFromCookie(cookie)
    }
    if (!variantURL) {
        let urls = await getVariantsURL()
        variantURL = selectURL(urls)
        injectVariantCookie = true
    }
    return getResponseStream(variantURL, injectVariantCookie)
}

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request))
})
