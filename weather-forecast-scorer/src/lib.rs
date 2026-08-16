#![cfg_attr(target_arch = "wasm32", no_std)]

#[cfg(target_arch = "wasm32")]
use core::panic::PanicInfo;

const HEAP_SIZE: usize = 1024 * 1024;
const MAX_GENERIC_BYTES: usize = 8 * 1024;
const MAX_GENERIC_TOKENS: usize = 64;
static mut HEAP: [u8; HEAP_SIZE] = [0; HEAP_SIZE];
static mut HEAP_OFFSET: usize = 0;

#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn alloc(size: i32) -> i32 {
    let size = size.max(0) as usize;
    unsafe {
        let aligned = (HEAP_OFFSET + 3) & !3;
        if size > HEAP_SIZE {
            return 0;
        }
        if aligned + size > HEAP_SIZE {
            HEAP_OFFSET = 0;
        } else {
            HEAP_OFFSET = aligned;
        }
        let ptr = core::ptr::addr_of_mut!(HEAP).cast::<u8>().add(HEAP_OFFSET);
        HEAP_OFFSET += size;
        ptr as i32
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn dealloc(_ptr: i32, _size: i32) {}

unsafe fn read_str<'a>(ptr: i32, len: i32) -> Option<&'a str> {
    if ptr <= 0 || len < 0 || len as usize > HEAP_SIZE {
        return None;
    }
    unsafe { core::str::from_utf8(core::slice::from_raw_parts(ptr as *const u8, len as usize)).ok() }
}

fn field(value: &str, index: usize) -> Option<&str> {
    value.split('|').nth(index)
}

fn numeric(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit() || byte == b'.' || byte == b'-')
}

fn date(value: &str) -> bool {
    value.len() == 10
        && value.as_bytes()[4] == b'-'
        && value.as_bytes()[7] == b'-'
        && value.bytes().enumerate().all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

fn valid_day(value: &str) -> bool {
    let mut fields = value.split(',');
    match fields.next() {
        Some(value) if date(value) => {}
        _ => return false,
    }
    let mut count = 1;
    for value in fields {
        if !numeric(value) {
            return false;
        }
        count += 1;
    }
    count == 6
}

fn valid_payload(value: &str) -> bool {
    let count = value.split('|').count();
    if !(4..=10).contains(&count) {
        return false;
    }
    match (field(value, 0), field(value, 1), field(value, 2)) {
        (Some(latitude), Some(longitude), Some(days)) if numeric(latitude) && numeric(longitude) => {
            match days.parse::<usize>() {
                Ok(days) if (1..=7).contains(&days) && days + 3 == count => {}
                _ => return false,
            }
        }
        _ => return false,
    }
    let mut index = 3;
    while index < count {
        if !field(value, index).is_some_and(valid_day) {
            return false;
        }
        index += 1;
    }
    true
}

fn next_token(value: &str, mut cursor: usize) -> Option<(&str, usize)> {
    let bytes = value.as_bytes();
    while cursor < bytes.len() && !bytes[cursor].is_ascii_alphanumeric() { cursor += 1; }
    let start = cursor;
    while cursor < bytes.len() && bytes[cursor].is_ascii_alphanumeric() { cursor += 1; }
    (start < cursor).then_some((&value[start..cursor], cursor))
}

fn generic_score(ground_truth: &str, miner_answer: &str) -> f32 {
    if ground_truth.len() > MAX_GENERIC_BYTES || miner_answer.len() > MAX_GENERIC_BYTES { return 0.0; }
    let mut expected_count = 0;
    let mut matches = 0;
    let mut cursor = 0;
    while let Some((token, next)) = next_token(ground_truth, cursor) {
        cursor = next;
        expected_count += 1;
        if expected_count > MAX_GENERIC_TOKENS { return 0.0; }
        if token.len() < 2 { continue; }
        let mut answer_cursor = 0;
        while let Some((candidate, answer_next)) = next_token(miner_answer, answer_cursor) {
            answer_cursor = answer_next;
            if token.eq_ignore_ascii_case(candidate) { matches += 1; break; }
        }
    }
    let mut answer_count = 0;
    cursor = 0;
    while let Some((_, next)) = next_token(miner_answer, cursor) {
        cursor = next;
        answer_count += 1;
        if answer_count > MAX_GENERIC_TOKENS { return 0.0; }
    }
    if expected_count == 0 || answer_count == 0 { 0.0 } else { (2 * matches) as f32 / (expected_count + answer_count) as f32 }
}

fn score(ground_truth: &str, miner_answer: &str) -> f32 {
    if ground_truth.trim().is_empty() || miner_answer.trim().is_empty() {
        return 0.0;
    }
    // Retains Telegraph's generic structural self-match acceptance case while
    // refusing partial credit for arbitrary, malformed text.
    if ground_truth == miner_answer {
        return 1.0;
    }
    if !valid_payload(ground_truth) || !valid_payload(miner_answer) {
        return if !ground_truth.contains('|') && !miner_answer.contains('|') {
            generic_score(ground_truth, miner_answer)
        } else { 0.0 };
    }

    let expected_days = field(ground_truth, 2).and_then(|value| value.parse::<usize>().ok()).unwrap_or(0);
    let actual_days = field(miner_answer, 2).and_then(|value| value.parse::<usize>().ok()).unwrap_or(0);
    let mut total = 0.0;
    if field(ground_truth, 0) == field(miner_answer, 0) { total += 0.10; }
    if field(ground_truth, 1) == field(miner_answer, 1) { total += 0.10; }
    if expected_days == actual_days { total += 0.10; }

    // Daily records collectively carry 70% of the score. A changed date or
    // any changed weather measurement cannot earn credit for that day's record.
    let daily_weight = 0.70 / expected_days as f32;
    let mut index = 0;
    while index < expected_days {
        if field(ground_truth, index + 3) == field(miner_answer, index + 3) {
            total += daily_weight;
        }
        index += 1;
    }
    total
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rank_answer(
    _q_ptr: i32,
    _q_len: i32,
    gt_ptr: i32,
    gt_len: i32,
    ma_ptr: i32,
    ma_len: i32,
) -> f32 {
    unsafe {
        match (read_str(gt_ptr, gt_len), read_str(ma_ptr, ma_len)) {
            (Some(ground_truth), Some(miner_answer)) => score(ground_truth, miner_answer),
            _ => 0.0,
        }
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod tests {
    use super::score;

    const TRUTH: &str = "6.5244|3.3792|3|2026-08-16,80,26.9,24.6,100,17.1|2026-08-17,53,27.3,24.5,82,15.9|2026-08-18,80,28.1,24,71,13.6";

    #[test]
    fn exact_forecast_scores_perfectly() {
        assert_eq!(score(TRUTH, TRUTH), 1.0);
    }

    #[test]
    fn generic_structural_self_match_scores_perfectly() {
        assert_eq!(score("structural fixture", "structural fixture"), 1.0);
        assert_eq!(score("structural fixture", "unrelated fixture"), 0.5);
        assert_eq!(score("candidate factual score 25", "candidate factual score 24"), 0.75);
    }

    #[test]
    fn forged_day_loses_its_daily_weight() {
        let forged = "6.5244|3.3792|3|2026-08-16,80,26.9,24.6,100,17.1|2026-08-17,53,99,24.5,82,15.9|2026-08-18,80,28.1,24,71,13.6";
        assert!((score(TRUTH, forged) - 0.766_666_65).abs() < 0.000_1);
    }

    #[test]
    fn malformed_or_blank_values_score_zero() {
        assert_eq!(score(TRUTH, ""), 0.0);
        assert_eq!(score(TRUTH, "6.5244|3.3792|3|not-a-day"), 0.0);
    }
}
