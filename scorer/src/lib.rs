#![cfg_attr(target_arch = "wasm32", no_std)]

#[cfg(target_arch = "wasm32")]
use core::panic::PanicInfo;

const HEAP_SIZE: usize = 1024 * 1024;
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
    unsafe {
        let bytes = core::slice::from_raw_parts(ptr as *const u8, len as usize);
        core::str::from_utf8(bytes).ok()
    }
}

fn field(value: &str, index: usize) -> Option<&str> {
    value.split('|').nth(index)
}

fn exact_field(ground_truth: &str, miner_answer: &str, index: usize) -> bool {
    match (field(ground_truth, index), field(miner_answer, index)) {
        (Some(expected), Some(actual)) if !expected.is_empty() => expected.eq_ignore_ascii_case(actual),
        _ => false,
    }
}

fn is_valid_payload(value: &str) -> bool {
    value.split('|').count() == 7
}

fn score(ground_truth: &str, miner_answer: &str) -> f32 {
    if miner_answer.trim().is_empty() || !is_valid_payload(ground_truth) || !is_valid_payload(miner_answer) {
        return 0.0;
    }
    if ground_truth == miner_answer {
        return 1.0;
    }

    // The transaction hash and final status carry most of the verdict. All other
    // fields must still agree for a top score, preventing a copied hash from gaming
    // the evaluation while preserving partial-credit ranking signal.
    let weights = [0.10_f32, 0.30, 0.25, 0.15, 0.075, 0.075, 0.05];
    let mut total = 0.0;
    let mut index = 0;
    while index < weights.len() {
        if exact_field(ground_truth, miner_answer, index) {
            total += weights[index];
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

    const TRUTH: &str = "base|0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|confirmed_success|123|0x1111111111111111111111111111111111111111|0x2222222222222222222222222222222222222222|1000000";

    #[test]
    fn exact_canonical_answer_scores_perfectly() {
        assert_eq!(score(TRUTH, TRUTH), 1.0);
    }

    #[test]
    fn blank_and_malformed_answers_score_zero() {
        assert_eq!(score(TRUTH, ""), 0.0);
        assert_eq!(score(TRUTH, "base|copied-hash"), 0.0);
    }

    #[test]
    fn copied_hash_cannot_score_high() {
        let forged = "base|0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|confirmed_reverted|999|0x3333333333333333333333333333333333333333|0x4444444444444444444444444444444444444444|1";
        assert!(score(TRUTH, forged) < 0.5);
    }
}
