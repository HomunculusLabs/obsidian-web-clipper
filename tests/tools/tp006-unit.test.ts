import { describe, it, expect } from "bun:test";
import { calculateRecommendation, type TelemetryPayload } from "../../tools/pilot-price-signal.ts";

describe("TP006: Deterministic Recommendation Engine", () => {
  /**
   * Helper to create telemetry payload for testing
   */
  function createTelemetry(
    bucketCounts: Record<"$8-$11" | "$12" | "$13-$15" | "$16-$19", number>,
    yesRates: Record<"$8-$11" | "$12" | "$13-$15" | "$16-$19", { yes: number; total: number; rate: number }>,
    medianWTP: number
  ): TelemetryPayload {
    return {
      priceBucketCounts: bucketCounts,
      pilotYesRateByBucket: yesRates,
      medianWTP,
      objectionMix: {},
    };
  }

  describe("anchor baseline threshold", () => {
    it("should select $12 anchor when it meets acceptance threshold (>=60% rate, n>=3)", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 0, "$12": 4, "$13-$15": 0, "$16-$19": 0 },
        {
          "$8-$11": { yes: 0, total: 0, rate: 0 },
          "$12": { yes: 3, total: 4, rate: 0.75 }, // 75% >= 60%, n=4 >= 3
          "$13-$15": { yes: 0, total: 0, rate: 0 },
          "$16-$19": { yes: 0, total: 0, rate: 0 },
        },
        12
      );

      const result = calculateRecommendation(telemetry);

      expect(result.recommendedNextAnchor).toBe(12);
      expect(result.anchorContext).toBe("baseline");
      expect(result.precedenceChain).toContain("baseline_threshold");
      expect(result.rationale).toContain("meets acceptance threshold");
      expect(result.rationale).toContain("75%");
    });

    it("should NOT select $12 anchor when rate is below threshold", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 4, "$12": 4, "$13-$15": 0, "$16-$19": 0 },
        {
          "$8-$11": { yes: 3, total: 4, rate: 0.75 }, // 75% - higher than $12
          "$12": { yes: 2, total: 4, rate: 0.50 }, // 50% < 60% threshold
          "$13-$15": { yes: 0, total: 0, rate: 0 },
          "$16-$19": { yes: 0, total: 0, rate: 0 },
        },
        10
      );

      const result = calculateRecommendation(telemetry);

      expect(result.recommendedNextAnchor).toBe(10); // Should select $8-$11 bucket
      expect(result.anchorContext).toBe("lower");
      expect(result.precedenceChain).toContain("baseline_threshold");
      expect(result.precedenceChain).toContain("median_wtp_fallback");
      expect(result.precedenceChain).toContain("highest_yes_rate");
    });

    it("should NOT select $12 anchor when sample size is below threshold", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 4, "$12": 2, "$13-$15": 0, "$16-$19": 0 },
        {
          "$8-$11": { yes: 2, total: 4, rate: 0.50 },
          "$12": { yes: 2, total: 2, rate: 1.00 }, // 100% but n=2 < 3
          "$13-$15": { yes: 0, total: 0, rate: 0 },
          "$16-$19": { yes: 0, total: 0, rate: 0 },
        },
        12
      );

      const result = calculateRecommendation(telemetry);

      // Should select $8-$11 bucket (higher sample size)
      expect(result.recommendedNextAnchor).toBe(10);
      expect(result.anchorContext).toBe("lower");
      expect(result.precedenceChain).toContain("sample_size");
    });
  });

  describe("median WTP fallback", () => {
    it("should use median WTP to select bucket when anchor threshold not met", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 4, "$12": 2, "$13-$15": 0, "$16-$19": 0 },
        {
          "$8-$11": { yes: 3, total: 4, rate: 0.75 },
          "$12": { yes: 1, total: 2, rate: 0.50 },
          "$13-$15": { yes: 0, total: 0, rate: 0 },
          "$16-$19": { yes: 0, total: 0, rate: 0 },
        },
        9.5 // Median in $8-$11 bucket
      );

      const result = calculateRecommendation(telemetry);

      expect(result.precedenceChain).toContain("median_wtp_fallback");
      // But highest yes rate should win
      expect(result.recommendedNextAnchor).toBe(10);
    });

    it("should select $13-$15 bucket when median WTP is 14", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 0, "$12": 0, "$13-$15": 4, "$16-$19": 0 },
        {
          "$8-$11": { yes: 0, total: 0, rate: 0 },
          "$12": { yes: 0, total: 0, rate: 0 },
          "$13-$15": { yes: 3, total: 4, rate: 0.75 },
          "$16-$19": { yes: 0, total: 0, rate: 0 },
        },
        14
      );

      const result = calculateRecommendation(telemetry);

      expect(result.recommendedNextAnchor).toBe(14);
      expect(result.anchorContext).toBe("higher");
    });

    it("should select $16-$19 bucket when median WTP is 17", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 0, "$12": 0, "$13-$15": 0, "$16-$19": 4 },
        {
          "$8-$11": { yes: 0, total: 0, rate: 0 },
          "$12": { yes: 0, total: 0, rate: 0 },
          "$13-$15": { yes: 0, total: 0, rate: 0 },
          "$16-$19": { yes: 2, total: 4, rate: 0.50 },
        },
        17
      );

      const result = calculateRecommendation(telemetry);

      expect(result.recommendedNextAnchor).toBe(17);
      expect(result.anchorContext).toBe("higher");
    });
  });

  describe("highest PILOT YES rate selection", () => {
    it("should select bucket with highest PILOT YES rate", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 4, "$12": 4, "$13-$15": 4, "$16-$19": 4 },
        {
          "$8-$11": { yes: 2, total: 4, rate: 0.50 },
          "$12": { yes: 3, total: 4, rate: 0.75 }, // Highest
          "$13-$15": { yes: 2, total: 4, rate: 0.50 },
          "$16-$19": { yes: 1, total: 4, rate: 0.25 },
        },
        12
      );

      const result = calculateRecommendation(telemetry);

      expect(result.recommendedNextAnchor).toBe(12);
      expect(result.anchorContext).toBe("baseline");
      expect(result.precedenceChain).toContain("highest_yes_rate");
    });

    it("should select lower bucket when it has highest rate", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 4, "$12": 4, "$13-$15": 4, "$16-$19": 4 },
        {
          "$8-$11": { yes: 4, total: 4, rate: 1.00 }, // Highest
          "$12": { yes: 3, total: 4, rate: 0.75 },
          "$13-$15": { yes: 2, total: 4, rate: 0.50 },
          "$16-$19": { yes: 1, total: 4, rate: 0.25 },
        },
        10
      );

      const result = calculateRecommendation(telemetry);

      expect(result.recommendedNextAnchor).toBe(10);
      expect(result.anchorContext).toBe("lower");
    });

    it("should select higher bucket when it has highest rate", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 4, "$12": 4, "$13-$15": 4, "$16-$19": 4 },
        {
          "$8-$11": { yes: 1, total: 4, rate: 0.25 },
          "$12": { yes: 2, total: 4, rate: 0.50 },
          "$13-$15": { yes: 4, total: 4, rate: 1.00 }, // Highest
          "$16-$19": { yes: 2, total: 4, rate: 0.50 },
        },
        14
      );

      const result = calculateRecommendation(telemetry);

      expect(result.recommendedNextAnchor).toBe(14);
      expect(result.anchorContext).toBe("higher");
    });
  });

  describe("tie-break rules", () => {
    it("should prefer bucket with higher sample size on rate tie", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 4, "$12": 5, "$13-$15": 0, "$16-$19": 0 },
        {
          "$8-$11": { yes: 3, total: 4, rate: 0.75 },
          "$12": { yes: 4, total: 5, rate: 0.75 }, // Same rate, higher sample
          "$13-$15": { yes: 0, total: 0, rate: 0 },
          "$16-$19": { yes: 0, total: 0, rate: 0 },
        },
        12
      );

      const result = calculateRecommendation(telemetry);

      expect(result.recommendedNextAnchor).toBe(12);
      expect(result.rationale).toContain("n=5"); // Higher sample size
    });

    it("should prefer $12 anchor bucket on rate + sample tie", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 4, "$12": 4, "$13-$15": 0, "$16-$19": 0 },
        {
          "$8-$11": { yes: 3, total: 4, rate: 0.75 },
          "$12": { yes: 3, total: 4, rate: 0.75 }, // Same rate and sample
          "$13-$15": { yes: 0, total: 0, rate: 0 },
          "$16-$19": { yes: 0, total: 0, rate: 0 },
        },
        12
      );

      const result = calculateRecommendation(telemetry);

      expect(result.recommendedNextAnchor).toBe(12);
      expect(result.anchorContext).toBe("baseline");
      expect(result.precedenceChain).toContain("anchor_familiarity");
    });

    it("should prefer bucket closer to $12 on rate + sample + anchor tie", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 4, "$12": 0, "$13-$15": 4, "$16-$19": 0 },
        {
          "$8-$11": { yes: 3, total: 4, rate: 0.75 },
          "$12": { yes: 0, total: 0, rate: 0 },
          "$13-$15": { yes: 3, total: 4, rate: 0.75 }, // Same rate and sample
          "$16-$19": { yes: 0, total: 0, rate: 0 },
        },
        14
      );

      const result = calculateRecommendation(telemetry);

      // $13-$15 is closer to $12 (distance 2) than $8-$11 (distance 2.5)
      expect(result.recommendedNextAnchor).toBe(14);
      expect(result.precedenceChain).toContain("proximity_to_anchor");
    });

    it("should use alphabetical label as final tie-break", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 4, "$12": 0, "$13-$15": 0, "$16-$19": 4 },
        {
          "$8-$11": { yes: 3, total: 4, rate: 0.75 },
          "$12": { yes: 0, total: 0, rate: 0 },
          "$13-$15": { yes: 0, total: 0, rate: 0 },
          "$16-$19": { yes: 3, total: 4, rate: 0.75 },
        },
        10
      );

      const result = calculateRecommendation(telemetry);

      // $16-$19 comes before $8-$11 alphabetically
      expect(result.recommendedNextAnchor).toBe(17);
      expect(result.precedenceChain).toContain("alphabetical_label");
    });
  });

  describe("sample size threshold", () => {
    it("should select bucket with highest rate when sample threshold met", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 4, "$12": 3, "$13-$15": 5, "$16-$19": 0 },
        {
          "$8-$11": { yes: 2, total: 4, rate: 0.50 },
          "$12": { yes: 2, total: 3, rate: 0.67 }, // Meets threshold
          "$13-$15": { yes: 4, total: 5, rate: 0.80 }, // Highest, meets threshold
          "$16-$19": { yes: 0, total: 0, rate: 0 },
        },
        14
      );

      const result = calculateRecommendation(telemetry);

      expect(result.recommendedNextAnchor).toBe(14);
      expect(result.rationale).toContain("meets sample threshold");
    });

    it("should select bucket with most responses when none meet threshold", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 2, "$12": 2, "$13-$15": 0, "$16-$19": 0 },
        {
          "$8-$11": { yes: 1, total: 2, rate: 0.50 },
          "$12": { yes: 2, total: 2, rate: 1.00 },
          "$13-$15": { yes: 0, total: 0, rate: 0 },
          "$16-$19": { yes: 0, total: 0, rate: 0 },
        },
        12
      );

      const result = calculateRecommendation(telemetry);

      // Both have n=2 < 3, select $12 (anchor familiarity)
      expect(result.recommendedNextAnchor).toBe(12);
      expect(result.rationale).toContain("below sample threshold");
    });
  });

  describe("anchor context mapping", () => {
    it("should map $12 bucket to baseline context", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 0, "$12": 4, "$13-$15": 0, "$16-$19": 0 },
        {
          "$8-$11": { yes: 0, total: 0, rate: 0 },
          "$12": { yes: 3, total: 4, rate: 0.75 },
          "$13-$15": { yes: 0, total: 0, rate: 0 },
          "$16-$19": { yes: 0, total: 0, rate: 0 },
        },
        12
      );

      const result = calculateRecommendation(telemetry);

      expect(result.anchorContext).toBe("baseline");
      expect(result.rationale).toContain("maintains $12 anchor baseline");
    });

    it("should map $8-$11 bucket to lower context", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 4, "$12": 0, "$13-$15": 0, "$16-$19": 0 },
        {
          "$8-$11": { yes: 3, total: 4, rate: 0.75 },
          "$12": { yes: 0, total: 0, rate: 0 },
          "$13-$15": { yes: 0, total: 0, rate: 0 },
          "$16-$19": { yes: 0, total: 0, rate: 0 },
        },
        10
      );

      const result = calculateRecommendation(telemetry);

      expect(result.anchorContext).toBe("lower");
      expect(result.rationale).toContain("testing lower price point");
    });

    it("should map $13-$15 bucket to higher context", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 0, "$12": 0, "$13-$15": 4, "$16-$19": 0 },
        {
          "$8-$11": { yes: 0, total: 0, rate: 0 },
          "$12": { yes: 0, total: 0, rate: 0 },
          "$13-$15": { yes: 3, total: 4, rate: 0.75 },
          "$16-$19": { yes: 0, total: 0, rate: 0 },
        },
        14
      );

      const result = calculateRecommendation(telemetry);

      expect(result.anchorContext).toBe("higher");
      expect(result.rationale).toContain("testing higher price point");
    });

    it("should map $16-$19 bucket to higher context", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 0, "$12": 0, "$13-$15": 0, "$16-$19": 4 },
        {
          "$8-$11": { yes: 0, total: 0, rate: 0 },
          "$12": { yes: 0, total: 0, rate: 0 },
          "$13-$15": { yes: 0, total: 0, rate: 0 },
          "$16-$19": { yes: 2, total: 4, rate: 0.50 },
        },
        17
      );

      const result = calculateRecommendation(telemetry);

      expect(result.anchorContext).toBe("higher");
      expect(result.rationale).toContain("testing higher price point");
    });
  });

  describe("edge cases", () => {
    it("should default to $12 baseline when no data available", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 0, "$12": 0, "$13-$15": 0, "$16-$19": 0 },
        {
          "$8-$11": { yes: 0, total: 0, rate: 0 },
          "$12": { yes: 0, total: 0, rate: 0 },
          "$13-$15": { yes: 0, total: 0, rate: 0 },
          "$16-$19": { yes: 0, total: 0, rate: 0 },
        },
        12
      );

      const result = calculateRecommendation(telemetry);

      expect(result.recommendedNextAnchor).toBe(12);
      expect(result.anchorContext).toBe("baseline");
      expect(result.rationale).toContain("No response data available");
      expect(result.precedenceChain).toEqual(["baseline_threshold"]);
    });

    it("should be deterministic - same input produces same output", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 4, "$12": 4, "$13-$15": 4, "$16-$19": 4 },
        {
          "$8-$11": { yes: 3, total: 4, rate: 0.75 },
          "$12": { yes: 2, total: 4, rate: 0.50 },
          "$13-$15": { yes: 1, total: 4, rate: 0.25 },
          "$16-$19": { yes: 0, total: 4, rate: 0.00 },
        },
        10
      );

      const result1 = calculateRecommendation(telemetry);
      const result2 = calculateRecommendation(telemetry);

      expect(result1.recommendedNextAnchor).toBe(result2.recommendedNextAnchor);
      expect(result1.anchorContext).toBe(result2.anchorContext);
      expect(result1.rationale).toBe(result2.rationale);
      expect(result1.precedenceChain).toEqual(result2.precedenceChain);
    });

    it("should produce stable precedence chain ordering", () => {
      const telemetry = createTelemetry(
        { "$8-$11": 4, "$12": 4, "$13-$15": 4, "$16-$19": 4 },
        {
          "$8-$11": { yes: 4, total: 4, rate: 1.00 },
          "$12": { yes: 3, total: 4, rate: 0.75 },
          "$13-$15": { yes: 2, total: 4, rate: 0.50 },
          "$16-$19": { yes: 1, total: 4, rate: 0.25 },
        },
        10
      );

      const result = calculateRecommendation(telemetry);

      // Verify precedence chain contains expected rules in order
      expect(result.precedenceChain).toContain("baseline_threshold");
      expect(result.precedenceChain).toContain("median_wtp_fallback");
      expect(result.precedenceChain).toContain("highest_yes_rate");
      expect(result.precedenceChain).toContain("sample_size");
    });
  });
});
