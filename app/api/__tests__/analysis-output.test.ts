/**
 * @jest-environment node
 */
import { ANALYSIS_OUTPUT_LIMITS, parseModelAnalysis, validateAnalysisText } from "../analysis-output";

const steps = ["1️⃣ Identify key themes", "2️⃣ Build on popular topics", "3️⃣ Share actionable insights"];
const valid = { summary: "People are excited about React 19 features.", actionRoadmap: steps };
const reply = (value: unknown) => JSON.stringify(value);

describe("parseModelAnalysis", () => {
  it("accepts a well-formed object", () => {
    expect(parseModelAnalysis(reply(valid))).toEqual(valid);
  });

  it("accepts ```json fences and surrounding prose", () => {
    expect(parseModelAnalysis("Here you go:\n```json\n" + reply(valid) + "\n```")).toEqual(valid);
  });

  it("trims whitespace and drops extra keys", () => {
    const result = parseModelAnalysis(
      reply({ summary: `  ${valid.summary}  `, actionRoadmap: steps.map((s) => ` ${s} `), isAdminDeleted: true })
    );
    expect(result).toEqual(valid);
    expect(result).not.toHaveProperty("isAdminDeleted");
  });

  it.each([
    ["not JSON", "no json here"],
    ["broken JSON", '{"summary": "x",'],
    ["an array", reply([valid])],
    ["a missing summary", reply({ actionRoadmap: steps })],
    ["an empty summary", reply({ ...valid, summary: "   " })],
    ["a placeholder summary", reply({ ...valid, summary: "..." })],
    ["a too-short summary", reply({ ...valid, summary: "Ok fine" })],
    ["a non-string summary", reply({ ...valid, summary: 42 })],
    ["a too-long summary", reply({ ...valid, summary: "a".repeat(ANALYSIS_OUTPUT_LIMITS.summaryMaxChars + 1) })],
    ["a missing roadmap", reply({ summary: valid.summary })],
    ["a non-array roadmap", reply({ ...valid, actionRoadmap: "1, 2, 3" })],
    ["two steps", reply({ ...valid, actionRoadmap: steps.slice(0, 2) })],
    ["four steps", reply({ ...valid, actionRoadmap: [...steps, "4️⃣ Extra step"] })],
    ["an empty step", reply({ ...valid, actionRoadmap: [steps[0], "", steps[2]] })],
    ["a placeholder step", reply({ ...valid, actionRoadmap: [steps[0], "2️⃣ ...", steps[2]] })],
    ["a non-string step", reply({ ...valid, actionRoadmap: [steps[0], { x: 1 }, steps[2]] })],
    ["a too-long step", reply({ ...valid, actionRoadmap: [steps[0], "b".repeat(ANALYSIS_OUTPUT_LIMITS.stepMaxChars + 1), steps[2]] })],
  ])("rejects %s", (_label, text) => {
    expect(parseModelAnalysis(text)).toBeNull();
  });
});

describe("validateAnalysisText", () => {
  it.each([null, undefined, "text", 3, []])("rejects %p", (value) => {
    expect(validateAnalysisText(value)).toBeNull();
  });
});
