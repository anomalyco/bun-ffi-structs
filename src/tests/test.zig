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
