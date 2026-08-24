#![cfg_attr(target_arch = "wasm32", no_std)]

#[cfg(target_arch = "wasm32")]
use core::panic::PanicInfo;

const HEAP_SIZE: usize = 1024 * 1024;
const MAX_BYTES: usize = 64 * 1024;
const MAX_TOKENS: usize = 512;
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

fn next_token(value: &str, mut cursor: usize) -> Option<(&str, usize)> {
    let bytes = value.as_bytes();
    while cursor < bytes.len() && !bytes[cursor].is_ascii_alphanumeric() { cursor += 1; }
    let start = cursor;
    while cursor < bytes.len() && bytes[cursor].is_ascii_alphanumeric() { cursor += 1; }
    (start < cursor).then_some((&value[start..cursor], cursor))
}

fn contains_token(value: &str, expected: &str) -> bool {
    let mut cursor = 0;
    while let Some((token, next)) = next_token(value, cursor) {
        cursor = next;
        if token.eq_ignore_ascii_case(expected) { return true; }
    }
    false
}

fn dice(ground_truth: &str, miner_answer: &str) -> f32 {
    let mut truth_count = 0;
    let mut answer_count = 0;
    let mut matches = 0;
    let mut cursor = 0;
    while let Some((token, next)) = next_token(ground_truth, cursor) {
        cursor = next;
        truth_count += 1;
        if truth_count > MAX_TOKENS { truth_count = MAX_TOKENS; break; }
        if token.len() >= 3 && contains_token(miner_answer, token) { matches += 1; }
    }
    cursor = 0;
    while let Some((_, next)) = next_token(miner_answer, cursor) {
        cursor = next;
        answer_count += 1;
        if answer_count > MAX_TOKENS { answer_count = MAX_TOKENS; break; }
    }
    if truth_count == 0 || answer_count == 0 { 0.0 } else { (2 * matches) as f32 / (truth_count + answer_count) as f32 }
}

fn question_coverage(question: &str, miner_answer: &str) -> f32 {
    let mut count = 0;
    let mut matches = 0;
    let mut cursor = 0;
    while let Some((token, next)) = next_token(question, cursor) {
        cursor = next;
        if token.len() < 4 { continue; }
        count += 1;
        if count > 128 { return 0.0; }
        if contains_token(miner_answer, token) { matches += 1; }
    }
    if count == 0 { 0.0 } else { matches as f32 / count as f32 }
}

fn score(question: &str, ground_truth: &str, miner_answer: &str) -> f32 {
    if ground_truth.trim().is_empty() || miner_answer.trim().is_empty() || ground_truth.len() > MAX_BYTES || miner_answer.len() > MAX_BYTES { return 0.0; }
    if ground_truth == miner_answer { return 1.0; }
    (0.85 * dice(ground_truth, miner_answer) + 0.15 * question_coverage(question, miner_answer)).min(1.0)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rank_answer(q_ptr: i32, q_len: i32, gt_ptr: i32, gt_len: i32, ma_ptr: i32, ma_len: i32) -> f32 {
    unsafe {
        match (read_str(q_ptr, q_len), read_str(gt_ptr, gt_len), read_str(ma_ptr, ma_len)) {
            (Some(question), Some(ground_truth), Some(miner_answer)) => score(question, ground_truth, miner_answer),
            _ => 0.0,
        }
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod tests {
    use super::score;

    #[test]
    fn exact_answer_scores_one() { assert_eq!(score("latest AI news", "article one", "article one"), 1.0); }

    #[test]
    fn relevant_sourced_answer_beats_unrelated_text() {
        let truth = "OpenAI released a model update on 2026-08-20 according to Reuters";
        let relevant = "Reuters: OpenAI released its model update on 2026-08-20";
        assert!(score("latest OpenAI model news", truth, relevant) > score("latest OpenAI model news", truth, "Football scores and recipes"));
    }

    #[test]
    fn structural_probe_has_variance() {
        assert_eq!(score("question", "structural fixture", "structural fixture"), 1.0);
        assert!(score("question", "structural fixture", "unrelated fixture") < 0.6);
    }

    #[test]
    fn blanks_score_zero() { assert_eq!(score("news", "truth", ""), 0.0); }
}
