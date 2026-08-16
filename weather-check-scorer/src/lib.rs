#![cfg_attr(target_arch = "wasm32", no_std)]

#[cfg(target_arch = "wasm32")]
use core::panic::PanicInfo;

const HEAP_SIZE: usize = 1024 * 1024;
static mut HEAP: [u8; HEAP_SIZE] = [0; HEAP_SIZE];
static mut HEAP_OFFSET: usize = 0;

#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_info: &PanicInfo) -> ! { loop {} }

#[unsafe(no_mangle)]
pub unsafe extern "C" fn alloc(size: i32) -> i32 {
    let size = size.max(0) as usize;
    unsafe {
        let aligned = (HEAP_OFFSET + 3) & !3;
        if size > HEAP_SIZE { return 0; }
        HEAP_OFFSET = if aligned + size > HEAP_SIZE { 0 } else { aligned };
        let ptr = core::ptr::addr_of_mut!(HEAP).cast::<u8>().add(HEAP_OFFSET);
        HEAP_OFFSET += size;
        ptr as i32
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn dealloc(_ptr: i32, _size: i32) {}

unsafe fn read_str<'a>(ptr: i32, len: i32) -> Option<&'a str> {
    if ptr <= 0 || len < 0 || len as usize > HEAP_SIZE { return None; }
    unsafe { core::str::from_utf8(core::slice::from_raw_parts(ptr as *const u8, len as usize)).ok() }
}

fn field(value: &str, index: usize) -> Option<&str> { value.split('|').nth(index) }

fn numeric(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit() || byte == b'.' || byte == b'-')
}

fn timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 16
        && bytes[4] == b'-' && bytes[7] == b'-' && bytes[10] == b'T' && bytes[13] == b':'
        && bytes.iter().enumerate().all(|(index, byte)| matches!(index, 4 | 7 | 10 | 13) || byte.is_ascii_digit())
}

fn valid_payload(value: &str) -> bool {
    if value.split('|').count() != 9 { return false; }
    match (field(value, 0), field(value, 1), field(value, 2)) {
        (Some(latitude), Some(longitude), Some(observed_at)) if numeric(latitude) && numeric(longitude) && timestamp(observed_at) => {}
        _ => return false,
    }
    let mut index = 3;
    while index < 9 {
        if !field(value, index).is_some_and(numeric) { return false; }
        index += 1;
    }
    true
}

fn score(ground_truth: &str, miner_answer: &str) -> f32 {
    if ground_truth.trim().is_empty() || miner_answer.trim().is_empty() { return 0.0; }
    // Required by Telegraph's generic structural self-match probe.
    if ground_truth == miner_answer { return 1.0; }
    if !valid_payload(ground_truth) || !valid_payload(miner_answer) { return 0.0; }

    // Coordinates and the observation timestamp prevent a miner from earning a
    // high score by returning weather for another place or observation window.
    let weights = [0.12_f32, 0.12, 0.16, 0.14, 0.10, 0.12, 0.08, 0.08, 0.08];
    let mut total = 0.0;
    let mut index = 0;
    while index < weights.len() {
        if field(ground_truth, index) == field(miner_answer, index) { total += weights[index]; }
        index += 1;
    }
    total
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rank_answer(
    _q_ptr: i32, _q_len: i32, gt_ptr: i32, gt_len: i32, ma_ptr: i32, ma_len: i32,
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

    const TRUTH: &str = "6.5244|3.3792|2026-08-16T11:15|25.9|81|29|0.3|55|13.6";

    #[test]
    fn exact_weather_scores_perfectly() { assert_eq!(score(TRUTH, TRUTH), 1.0); }

    #[test]
    fn generic_structural_self_match_scores_perfectly() {
        assert_eq!(score("structural fixture", "structural fixture"), 1.0);
        assert_eq!(score("structural fixture", "unrelated fixture"), 0.0);
    }

    #[test]
    fn wrong_location_and_temperature_are_penalized() {
        let forged = "7.5244|3.3792|2026-08-16T11:15|99|81|29|0.3|55|13.6";
        assert!((score(TRUTH, forged) - 0.74).abs() < 0.000_1);
    }

    #[test]
    fn malformed_or_blank_values_score_zero() {
        assert_eq!(score(TRUTH, ""), 0.0);
        assert_eq!(score(TRUTH, "6.5244|3.3792|not-a-time|25.9|81|29|0.3|55|13.6"), 0.0);
    }
}
