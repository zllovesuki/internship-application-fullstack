/**
 * CloudFlare 2020 Summer Remote Internship Fullstack coding challenge
 * (c) Rachel Chen (@zllovesuki on Github)
 *
 * Important Notes:
 * COOKIE_KEY is the secret used to encrypt/decrypt the variant URL before sending to the client
 * Please make sure that you set this via "wrangler secret set COOKIE_KEY"
 *
 */

/**
 * Element handler to rewrite the link and text to my portfolio
 */
class LinkRewriter {
    element(el) {
        el.setAttribute('href', 'https://miragespace.com')
        el.setInnerContent('See Rachel\'s Portfolio')
    }
}

/**
 * Element handler to add UTF-8 encoding, and change the title of the page
 */
class MetaRewriter {
    element(el) {
        // outrageously, document encoding was not set??
        el.before('<meta charset="utf-8">', { html: true })
        el.prepend('You are visiting ')
    }
}

/**
 * Element handler to change the description on the page
 */
class BodyRewriter {
    element(el) {
        el.setInnerContent('This is <a style="color: #3090C7" href="https://github.com/zllovesuki/internship-application-fullstack">my version</a> of CloudFlare\'s Summer 2020 Internship Coding Challenge. The variant will persist for one week (or you can just clear the cookie).', { html: true} )
    }
}

/**
 * Worker constatns
 */
// where to get out URLs
const VARIANTS_API = 'https://cfw-takehome.developers.workers.dev/api/variants'
const VARIANT_COOKIE_NAME = 'variant'
const REWRITER  = new HTMLRewriter()
    .on('title', new MetaRewriter())
    .on('p#description', new BodyRewriter())
    .on('a#url', new LinkRewriter())

/**
 * Helper function to generate the weight for each URL
 * Currently it is equally likely to get either one
 */
function getURLWeights(urls) {
    return urls.map(() => 50) // 50/50 chance
}

/**
 * Return an URL from the list randomly based on a predetermined weight
 */
function selectURL(urls) {
    let weights = getURLWeights(urls)
    let weightSum = weights.reduce((accumulator, weight) => accumulator + weight, 0)
    let rand = Math.random() * weightSum
    // normalized weight
    let accumulator = 0
    weights = weights.map(weight => (accumulator = accumulator + weight))
    return urls[weights.findIndex(prob => prob > rand)]
}

/**
 * Async function to return a list of variants
 */
async function getVariantsURL() {
    let variantsResp = await fetch(VARIANTS_API)
    let variantsJson = await variantsResp.json()
    return variantsJson.variants
}

/**
 * Generate a Response by fetching from the variant.
 * Using Streaming Passthrough to avoid unnecessary buffering.
 * It also optionally injects an encrypted Cookie to persist which variant the visitor will see
 */
async function getResponseStream(url, injectCookie) {
    // https://developers.cloudflare.com/workers/reference/apis/streams/#streaming-passthrough
    let response = await fetch(url)
    let variantResponse = new Response(REWRITER.transform(response).body, response)
    if (injectCookie) {
        const encryptedURL = await aesGcmEncrypt(url, COOKIE_KEY)
        let expires = new Date()
        expires.setDate(expires.getDate() + 7) // persistent for one week
        variantResponse.headers.append('Set-Cookie', `${VARIANT_COOKIE_NAME}=${encryptedURL}; Expires=${expires.toGMTString()}; Secure; HttpOnly; path=/;`)
    }
    return variantResponse
}

// via https://developers.cloudflare.com/workers/templates/pages/cookie_extract/
/**
 * Grabs the cookie with name from the request headers
 * @param {Request} request incoming Request
 * @param {string} name of the cookie to grab
 */
function getCookie(request, name) {
    let cookieString = request.headers.get('Cookie')
    if (cookieString) {
        let cookies = cookieString.split(';')
        for (const cookie of cookies) {
            let cookieName = cookie.split('=')[0].trim()
            if (cookieName === name) {
                let cookieVal = cookie.split('=')[1]
                return cookieVal
            }
        }
    }
    return null
}

/**
 * Attempt to get the encrypted URL from Cookie and decrypt it
 * Returns null if variant Cookie is not found or the Cookie was tampered
 */
async function getVariantFromCookie(request) {
    const encryptedURL = getCookie(request, VARIANT_COOKIE_NAME)
    if (encryptedURL) {
        try {
            return await aesGcmDecrypt(encryptedURL, COOKIE_KEY)
        } catch(e) {}
    }
    return null
}

/**
 * Request Handler
 */
async function handleRequest(request) {
    // A/B Testing cookie: https://developers.cloudflare.com/workers/templates/#ab_testing
    let injectVariantCookie = false
    let variantURL = await getVariantFromCookie(request)
    if (!variantURL) {
        let urls = await getVariantsURL()
        variantURL = selectURL(urls)
        injectVariantCookie = true
    }
    return getResponseStream(variantURL, injectVariantCookie)
}

/**
 * Entry point
 */
addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request))
})

// encryption/decryption provided via https://gist.github.com/chrisveness/43bcda93af9f646d083fad678071b90a

/**
 * Encrypts plaintext using AES-GCM with supplied password, for decryption with aesGcmDecrypt().
 *                                                                      (c) Chris Veness MIT Licence
 *
 * @param   {String} plaintext - Plaintext to be encrypted.
 * @param   {String} password - Password to use to encrypt plaintext.
 * @returns {String} Encrypted ciphertext.
 *
 * @example
 *   const ciphertext = await aesGcmEncrypt('my secret text', 'pw');
 *   aesGcmEncrypt('my secret text', 'pw').then(function(ciphertext) { console.log(ciphertext); });
 */
async function aesGcmEncrypt(plaintext, password) {
    const pwUtf8 = new TextEncoder().encode(password);                                 // encode password as UTF-8
    const pwHash = await crypto.subtle.digest('SHA-256', pwUtf8);                      // hash the password

    const iv = crypto.getRandomValues(new Uint8Array(12));                             // get 96-bit random iv

    const alg = { name: 'AES-GCM', iv: iv };                                           // specify algorithm to use

    const key = await crypto.subtle.importKey('raw', pwHash, alg, false, ['encrypt']); // generate key from pw

    const ptUint8 = new TextEncoder().encode(plaintext);                               // encode plaintext as UTF-8
    const ctBuffer = await crypto.subtle.encrypt(alg, key, ptUint8);                   // encrypt plaintext using key

    const ctArray = Array.from(new Uint8Array(ctBuffer));                              // ciphertext as byte array
    const ctStr = ctArray.map(byte => String.fromCharCode(byte)).join('');             // ciphertext as string
    const ctBase64 = btoa(ctStr);                                                      // encode ciphertext as base64

    const ivHex = Array.from(iv).map(b => ('00' + b.toString(16)).slice(-2)).join(''); // iv as hex string

    return ivHex+ctBase64;                                                             // return iv+ciphertext
}


/**
 * Decrypts ciphertext encrypted with aesGcmEncrypt() using supplied password.
 *                                                                      (c) Chris Veness MIT Licence
 *
 * @param   {String} ciphertext - Ciphertext to be decrypted.
 * @param   {String} password - Password to use to decrypt ciphertext.
 * @returns {String} Decrypted plaintext.
 *
 * @example
 *   const plaintext = await aesGcmDecrypt(ciphertext, 'pw');
 *   aesGcmDecrypt(ciphertext, 'pw').then(function(plaintext) { console.log(plaintext); });
 */
async function aesGcmDecrypt(ciphertext, password) {
    const pwUtf8 = new TextEncoder().encode(password);                                  // encode password as UTF-8
    const pwHash = await crypto.subtle.digest('SHA-256', pwUtf8);                       // hash the password

    const iv = ciphertext.slice(0,24).match(/.{2}/g).map(byte => parseInt(byte, 16));   // get iv from ciphertext

    const alg = { name: 'AES-GCM', iv: new Uint8Array(iv) };                            // specify algorithm to use

    const key = await crypto.subtle.importKey('raw', pwHash, alg, false, ['decrypt']);  // use pw to generate key

    const ctStr = atob(ciphertext.slice(24));                                           // decode base64 ciphertext
    const ctUint8 = new Uint8Array(ctStr.match(/[\s\S]/g).map(ch => ch.charCodeAt(0))); // ciphertext as Uint8Array
    // note: why doesn't ctUint8 = new TextEncoder().encode(ctStr) work?

    const plainBuffer = await crypto.subtle.decrypt(alg, key, ctUint8);                 // decrypt ciphertext using key
    const plaintext = new TextDecoder().decode(plainBuffer);                            // decode password from UTF-8

    return plaintext;                                                                   // return the plaintext
}
