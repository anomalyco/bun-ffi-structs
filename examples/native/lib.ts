import { dlopen, CString, ptr } from "bun:ffi"
import { defineStruct } from "../../src/structs_ffi.js"

const PersonStruct = defineStruct([
  ["age", "u32"],
  ["height", "f32"],
  ["weight", "f64"],
  ["name", "cstring"],
] as const)

const native = dlopen("libnative.dylib", {
  get_age: {
    args: ["ptr"],
    returns: "u32",
  },
  get_height: {
    args: ["ptr"],
    returns: "f32",
  },
  get_weight: {
    args: ["ptr"],
    returns: "f64",
  },
  get_name: {
    args: ["ptr"],
    returns: "ptr",
  },
  calculate_bmi: {
    args: ["ptr"],
    returns: "f32",
  },
})

export type Person = {
  age: number
  height: number
  weight: number
  name: string
}

export function getAge(personBuffer: ArrayBuffer): number {
  return native.symbols.get_age(ptr(personBuffer))
}

export function getHeight(personBuffer: ArrayBuffer): number {
  return native.symbols.get_height(ptr(personBuffer))
}

export function getWeight(personBuffer: ArrayBuffer): number {
  return native.symbols.get_weight(ptr(personBuffer))
}

export function getName(personBuffer: ArrayBuffer): string {
  const namePtr = native.symbols.get_name(ptr(personBuffer))
  if (!namePtr) return ""
  return new CString(namePtr).toString()
}

export function calculateBMI(personBuffer: ArrayBuffer): number {
  return native.symbols.calculate_bmi(ptr(personBuffer))
}

export { PersonStruct }
