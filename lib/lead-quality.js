// Lead-quality heuristics — used by /api/lead to decide whether to fire CAPI.
// Lead still saves to Supabase + Apps Script either way (you keep the data
// for audit / refund / blocklist), but Meta only learns from leads where
// the contact info looks real. Otherwise the algo trains itself to find
// more people who fill in fake numbers.

const FAKE_EMAIL_DOMAINS = [
    'test.com', 'test.test', 'example.com', 'example.org', 'example.net',
    'localhost', 'invalid', 'fake.com', 'fakemail', 'mailinator.com',
    'tempmail', 'trash-mail', 'yopmail.com', 'guerrillamail',
    '10minutemail', 'throwaway.email', 'sharklasers.com', 'getnada.com',
    'temp-mail', 'mohmal.com', 'discard.email', 'maildrop.cc'
];

const FAKE_EMAIL_LOCAL_PREFIXES = [
    'test', 'asdf', 'qwerty', 'aaa', 'bbb', 'abc', 'fake', 'none',
    'noemail', 'noreply', 'no-reply', 'admin', 'webmaster', 'spam',
    'a@', 'a1', 'sample'
];

function digitsOnly(s) {
    return String(s || '').replace(/\D/g, '');
}

function looksLikeRealPhone(phone) {
    if (!phone) return { ok: false, reason: 'empty' };
    let digits = digitsOnly(phone);
    if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
    if (digits.length !== 10) return { ok: false, reason: 'wrong_length:' + digits.length };

    const area = digits.slice(0, 3);
    const exchange = digits.slice(3, 6);
    const subscriber = digits.slice(6, 10);

    // Area code rules
    const areaNum = parseInt(area, 10);
    if (areaNum < 200) return { ok: false, reason: 'invalid_area:' + area };
    if (digits[0] === '0' || digits[0] === '1') return { ok: false, reason: 'area_starts_0_or_1' };

    // 555 area code = fictional / unassigned
    if (area === '555') return { ok: false, reason: 'fictional_555_area' };

    // Exchange code can't start with 0 or 1
    if (exchange[0] === '0' || exchange[0] === '1') return { ok: false, reason: 'exchange_starts_0_or_1' };

    // 555-01XX is FCC-reserved for fictional use (the classic "555-0100" range)
    if (exchange === '555' && /^01/.test(subscriber)) return { ok: false, reason: 'fictional_555_01xx' };

    // All same digit (1111111111, 5555555555)
    if (/^(\d)\1{9}$/.test(digits)) return { ok: false, reason: 'all_same_digit' };

    // Obviously sequential (1234567890, 0123456789, 9876543210)
    if (digits === '1234567890' || digits === '0123456789' || digits === '9876543210') {
        return { ok: false, reason: 'sequential_digits' };
    }

    // Long runs of the same digit at the start (e.g. 0000123456)
    if (/^(\d)\1{4}/.test(digits)) return { ok: false, reason: 'leading_repeats' };

    return { ok: true };
}

function looksLikeRealEmail(email) {
    if (!email) return { ok: false, reason: 'empty' };
    const trimmed = String(email).toLowerCase().trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return { ok: false, reason: 'invalid_format' };
    }

    const [local, domain] = trimmed.split('@');
    if (!local || !domain) return { ok: false, reason: 'no_local_or_domain' };

    // Domain blocklist (catches @test.com, @example.com, all the temp-mail providers)
    for (const fake of FAKE_EMAIL_DOMAINS) {
        if (domain === fake || domain.endsWith('.' + fake) || domain.includes(fake)) {
            return { ok: false, reason: 'fake_domain:' + domain };
        }
    }

    // Obvious junk local-parts
    for (const prefix of FAKE_EMAIL_LOCAL_PREFIXES) {
        if (local === prefix || local.startsWith(prefix + '@') || local === prefix + '123') {
            return { ok: false, reason: 'junk_local:' + local };
        }
    }

    // All same character (aaa@..., 1111@...)
    if (/^(.)\1{2,}$/.test(local)) return { ok: false, reason: 'repeated_local' };

    // Single character before @
    if (local.length < 2) return { ok: false, reason: 'too_short_local' };

    return { ok: true };
}

function assessLeadQuality(payload) {
    const u = (payload && payload.userData) || {};
    const phoneCheck = looksLikeRealPhone(u.phone);
    const emailCheck = looksLikeRealEmail(u.email);

    const reasons = [];
    if (!phoneCheck.ok) reasons.push('phone:' + phoneCheck.reason);
    if (!emailCheck.ok) reasons.push('email:' + emailCheck.reason);

    return {
        ok: phoneCheck.ok && emailCheck.ok,
        phone_ok: phoneCheck.ok,
        email_ok: emailCheck.ok,
        reasons: reasons
    };
}

module.exports = { looksLikeRealPhone, looksLikeRealEmail, assessLeadQuality };
