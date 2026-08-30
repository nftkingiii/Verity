#![cfg_attr(target_arch = "wasm32", no_std)]

#[cfg(target_arch = "wasm32")]
use core::panic::PanicInfo;

#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_info: &PanicInfo) -> ! { loop {} }

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
unsafe extern "C" {
    #[link_name = "rank_answer"]
    fn upstream_rank_answer(
        q_ptr: i32, q_len: i32,
        gt_ptr: i32, gt_len: i32,
        ma_ptr: i32, ma_len: i32,
    ) -> f32;
}

#[cfg(target_arch = "wasm32")]
unsafe fn call_upstream(
    q_ptr: i32, q_len: i32, gt_ptr: i32, gt_len: i32, ma_ptr: i32, ma_len: i32,
) -> f32 {
    unsafe { upstream_rank_answer(q_ptr, q_len, gt_ptr, gt_len, ma_ptr, ma_len) }
}

#[cfg(not(target_arch = "wasm32"))]
unsafe fn call_upstream(
    _q_ptr: i32, _q_len: i32, _gt_ptr: i32, _gt_len: i32, _ma_ptr: i32, _ma_len: i32,
) -> f32 { 0.0 }

fn lower(byte: u8) -> u8 {
    if byte.is_ascii_uppercase() { byte + 32 } else { byte }
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() || needle.len() > haystack.len() { return false; }
    let mut start = 0;
    while start + needle.len() <= haystack.len() {
        let mut index = 0;
        while index < needle.len() && lower(haystack[start + index]) == lower(needle[index]) {
            index += 1;
        }
        if index == needle.len() { return true; }
        start += 1;
    }
    false
}

fn positive(value: &[u8]) -> bool {
    contains(value, b"success") || contains(value, b"succeeded") || contains(value, b"successful")
}

fn negative(value: &[u8]) -> bool {
    contains(value, b"failed") || contains(value, b"failure") || contains(value, b"revert")
}

fn polarity_contradiction(ground_truth: &[u8], answer: &[u8]) -> bool {
    (positive(ground_truth) && negative(answer))
        || (negative(ground_truth) && positive(answer))
        || (contains(ground_truth, b"inflow") && contains(answer, b"outflow"))
        || (contains(ground_truth, b"outflow") && contains(answer, b"inflow"))
        || (contains(ground_truth, b"increase") && contains(answer, b"decrease"))
        || (contains(ground_truth, b"decrease") && contains(answer, b"increase"))
        || (contains(ground_truth, b"rain") && contains(answer, b"no rain"))
}

fn is_number_byte(byte: u8) -> bool {
    byte.is_ascii_digit() || byte == b'.' || byte == b'-' || byte == b'+' || byte == b'%'
}

fn next_number(value: &[u8], mut cursor: usize) -> Option<(&[u8], usize)> {
    while cursor < value.len() && !value[cursor].is_ascii_digit() { cursor += 1; }
    if cursor == value.len() { return None; }
    let mut start = cursor;
    if start > 0 && matches!(value[start - 1], b'-' | b'+') { start -= 1; }
    let mut end = cursor + 1;
    while end < value.len() && is_number_byte(value[end]) { end += 1; }
    // Ignore digits embedded in hashes, dates with letters, and identifiers.
    if (start > 0 && value[start - 1].is_ascii_alphabetic())
        || (end < value.len() && value[end].is_ascii_alphabetic()) {
        return next_number(value, end);
    }
    Some((&value[start..end], end))
}

fn numeric_recall(ground_truth: &[u8], answer: &[u8]) -> Option<f32> {
    let mut expected = 0_u32;
    let mut matched = 0_u32;
    let mut cursor = 0;
    while let Some((number, next)) = next_number(ground_truth, cursor) {
        cursor = next;
        expected += 1;
        if expected > 64 { break; }
        let mut answer_cursor = 0;
        while let Some((candidate, answer_next)) = next_number(answer, answer_cursor) {
            answer_cursor = answer_next;
            if number == candidate { matched += 1; break; }
        }
    }
    (expected >= 2).then_some(matched as f32 / expected as f32)
}

fn calibrate(raw: f32) -> f32 {
    if raw <= 0.20 {
        raw * 0.01
    } else if raw >= 0.60 {
        1.0 - (1.0 - raw) * 0.01
    } else {
        0.002 + ((raw - 0.20) / 0.40) * 0.994
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn calibrated_rank_answer(
    q_ptr: i32, q_len: i32,
    gt_ptr: i32, gt_len: i32,
    ma_ptr: i32, ma_len: i32,
) -> f32 {
    if gt_ptr <= 0 || ma_ptr <= 0 || gt_len <= 0 || ma_len <= 0 { return 0.0; }
    let ground_truth = unsafe { core::slice::from_raw_parts(gt_ptr as *const u8, gt_len as usize) };
    let answer = unsafe { core::slice::from_raw_parts(ma_ptr as *const u8, ma_len as usize) };
    let raw = unsafe { call_upstream(q_ptr, q_len, gt_ptr, gt_len, ma_ptr, ma_len) }.clamp(0.0, 1.0);
    if polarity_contradiction(ground_truth, answer) { return calibrate(raw) * 0.001; }
    if let Some(recall) = numeric_recall(ground_truth, answer) {
        if recall < 0.5 { return calibrate(raw) * 0.01; }
        if raw < 0.20 {
            return (recall * 0.95 + raw * 0.00005).clamp(0.0, 1.0);
        }
    }
    calibrate(raw)
}

#[cfg(test)]
mod tests {
    use super::{calibrate, numeric_recall, polarity_contradiction};

    #[test]
    fn detects_decisive_polarity_reversals() {
        assert!(polarity_contradiction(b"transaction succeeded", b"transaction reverted"));
        assert!(polarity_contradiction(b"ETF inflows", b"ETF outflows"));
        assert!(polarity_contradiction(b"rain expected", b"no rain expected"));
    }

    #[test]
    fn numeric_recall_rewards_matching_facts() {
        let good = numeric_recall(b"high 25 low 14 on day 2", b"day 2 has high 25 and low 14").unwrap();
        let bad = numeric_recall(b"high 25 low 14 on day 2", b"day 3 has high 40 and low 30").unwrap();
        assert!(good > bad);
    }

    #[test]
    fn calibration_is_monotonic_and_keeps_rail_ordering() {
        assert!(calibrate(0.01) < calibrate(0.10));
        assert!(calibrate(0.70) < calibrate(0.90));
        assert!(calibrate(0.10) < calibrate(0.90));
    }
}
