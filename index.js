/**
 * CloudFlare 2020 Summer Remote Internship Fullstack coding challenge
 * (c) Rachel Chen (@zllovesuki on Github)
 */

// where to get out URLs
const variantsAPI = 'https://cfw-takehome.developers.workers.dev/api/variants'
const variantCookieName = 'variant'
// regular expression to get out cookie
// http://www.javascripter.net/faq/readingacookie.htm
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
        let encryptedURL = await aesGcmEncrypt(url, COOKIE_KEY)
        let expires = new Date();
        expires.setDate(expires.getDate() + 7) // persistent for one week
        variantResponse.headers.append('Set-Cookie', `${variantCookieName}=${encryptedURL}; Expires=${expires.toGMTString()}; Secure; HttpOnly; path=/`)
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

async function handleRequest(request) {
    // A/B Testing cookie: https://developers.cloudflare.com/workers/templates/#ab_testing
    let variantURL = null;
    let injectVariantCookie = false
    const cookie = request.headers.get('cookie')
    if (cookie) {
        try {
            encryptedURL = getVariantFromCookie(cookie)
            variantURL = await aesGcmDecrypt(encryptedURL, COOKIE_KEY)
        } catch(e) {}
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
