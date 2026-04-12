const std = @import("std");

pub const SimplePerson = extern struct {
    age: u32,
    height: f32,
    weight: f64,
};

var test_person: SimplePerson = undefined;

export fn createTestPerson() *anyopaque {
    test_person = SimplePerson{
        .age = 30,
        .height = 175.5,
        .weight = 70.2,
    };

    return @as(*anyopaque, @ptrCast(&test_person));
}

export fn validatePerson(ptr: *anyopaque, expected_age: u32, expected_height: f32, expected_weight: f64) bool {
    const person = @as(*const SimplePerson, @ptrCast(@alignCast(ptr)));

    if (person.age != expected_age) return false;

    const height_match = @abs(person.height - expected_height) < 0.01;
    if (!height_match) return false;

    const weight_match = @abs(person.weight - expected_weight) < 0.01;
    if (!weight_match) return false;

    return true;
}

// Struct with char* field and lengthOf
pub const Highlight = extern struct {
    start: u32,
    end: u32,
    style_id: u32,
    priority: u8,
    hl_ref: u16,
    // padding: 1 byte
    conceal_text_ptr: ?[*]const u8,
    conceal_text_len: u64,
};

// Static storage for test strings
var test_string_1: []const u8 = "XXX";
var test_string_2: []const u8 = "******";
var test_string_3: []const u8 = "Hello🌍";

var test_highlights: [3]Highlight = undefined;

export fn createHighlightList() *anyopaque {
    // Create 3 highlights with different conceal texts
    test_highlights[0] = Highlight{
        .start = 6,
        .end = 11,
        .style_id = 1,
        .priority = 0,
        .hl_ref = 0,
        .conceal_text_ptr = test_string_1.ptr,
        .conceal_text_len = test_string_1.len,
    };

    test_highlights[1] = Highlight{
        .start = 18,
        .end = 24,
        .style_id = 2,
        .priority = 5,
        .hl_ref = 10,
        .conceal_text_ptr = test_string_2.ptr,
        .conceal_text_len = test_string_2.len,
    };

    test_highlights[2] = Highlight{
        .start = 30,
        .end = 35,
        .style_id = 3,
        .priority = 1,
        .hl_ref = 20,
        .conceal_text_ptr = test_string_3.ptr,
        .conceal_text_len = test_string_3.len,
    };

    return @as(*anyopaque, @ptrCast(&test_highlights));
}

export fn validateHighlight(
    ptr: *anyopaque,
    expected_start: u32,
    expected_end: u32,
    expected_style_id: u32,
    expected_priority: u8,
    expected_hl_ref: u16,
    expected_text_ptr: ?[*]const u8,
    expected_text_len: usize,
) bool {
    const highlight = @as(*const Highlight, @ptrCast(@alignCast(ptr)));

    if (highlight.start != expected_start) return false;
    if (highlight.end != expected_end) return false;
    if (highlight.style_id != expected_style_id) return false;
    if (highlight.priority != expected_priority) return false;
    if (highlight.hl_ref != expected_hl_ref) return false;

    // Check pointer and length
    if (expected_text_ptr == null) {
        if (highlight.conceal_text_ptr != null) return false;
        if (highlight.conceal_text_len != 0) return false;
    } else {
        if (highlight.conceal_text_ptr == null) return false;
        if (highlight.conceal_text_len != expected_text_len) return false;

        // Compare actual text content
        const actual_text = highlight.conceal_text_ptr.?[0..highlight.conceal_text_len];
        const expected_text = expected_text_ptr.?[0..expected_text_len];

        if (!std.mem.eql(u8, actual_text, expected_text)) return false;
    }

    return true;
}

export fn validateHighlightList(ptr: *anyopaque, count: usize) bool {
    const highlights = @as([*]const Highlight, @ptrCast(@alignCast(ptr)));

    if (count < 3) return false;

    // Validate first highlight
    const h1 = highlights[0];
    if (h1.start != 6 or h1.end != 11 or h1.style_id != 1) return false;
    if (h1.priority != 0 or h1.hl_ref != 0) return false;
    if (h1.conceal_text_ptr == null or h1.conceal_text_len != 3) return false;
    const text1 = h1.conceal_text_ptr.?[0..h1.conceal_text_len];
    if (!std.mem.eql(u8, text1, "XXX")) return false;

    // Validate second highlight
    const h2 = highlights[1];
    if (h2.start != 18 or h2.end != 24 or h2.style_id != 2) return false;
    if (h2.priority != 5 or h2.hl_ref != 10) return false;
    if (h2.conceal_text_ptr == null or h2.conceal_text_len != 6) return false;
    const text2 = h2.conceal_text_ptr.?[0..h2.conceal_text_len];
    if (!std.mem.eql(u8, text2, "******")) return false;

    // Validate third highlight
    const h3 = highlights[2];
    if (h3.start != 30 or h3.end != 35 or h3.style_id != 3) return false;
    if (h3.priority != 1 or h3.hl_ref != 20) return false;
    if (h3.conceal_text_ptr == null) return false;
    const text3 = h3.conceal_text_ptr.?[0..h3.conceal_text_len];
    if (!std.mem.eql(u8, text3, "Hello🌍")) return false;

    return true;
}

// i64 signed integer tests
pub const TimestampStruct = extern struct {
    created_at: i64,
    modified_at: i64,
    deleted_at: i64,
};

var test_timestamp: TimestampStruct = undefined;

export fn createTestTimestamp() *anyopaque {
    test_timestamp = TimestampStruct{
        .created_at = -1640000000000,
        .modified_at = 1640000000000,
        .deleted_at = 0,
    };
    return @as(*anyopaque, @ptrCast(&test_timestamp));
}

export fn validateTimestamp(ptr: *anyopaque, expected_created: i64, expected_modified: i64, expected_deleted: i64) bool {
    const ts = @as(*const TimestampStruct, @ptrCast(@alignCast(ptr)));
    if (ts.created_at != expected_created) return false;
    if (ts.modified_at != expected_modified) return false;
    if (ts.deleted_at != expected_deleted) return false;
    return true;
}
