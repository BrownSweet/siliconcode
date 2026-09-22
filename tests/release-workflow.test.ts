import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(join(process.cwd(), ".github", "workflows", "publish.yml"), "utf8");

describe("npm publish workflow", () => {
  it("publishes @brownsweet/siliconcode from semver tags through trusted publishing", () => {
    expect(workflow).toContain("tags:");
    expect(workflow).toContain("'v*.*.*'");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("environment: npm");
    expect(workflow).toContain("uses: actions/setup-node@v6");
    expect(workflow).toContain("node-version: 24");
    expect(workflow).toContain("package-manager-cache: false");
    expect(workflow).toContain("npm run verify");
    expect(workflow).toContain("GITHUB_REF_NAME#v");
    expect(workflow).toContain("package.json");
    expect(workflow).toContain('PACKAGE_NAME="$(node -p "require(\'./package.json\').name")"');
    expect(workflow).toContain('npm view "${PACKAGE_NAME}@${PACKAGE_VERSION}" version');
    expect(workflow).toContain('echo "publish=true" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain("steps.npm_version.outputs.publish == 'true'");
    expect(workflow).toContain("npm publish --access public --provenance");
  });

  it("skips already-published and historical package versions without failing", () => {
    expect(workflow).toContain('npm view "${PACKAGE_NAME}" versions --json');
    expect(workflow).toContain('echo "publish=false" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain("already exists on npm; skipping publish");
    expect(workflow).toContain("is not newer than latest published");
    expect(workflow).toContain("steps.npm_version.outputs.publish == 'true'");
    expect(workflow).not.toContain("already exists with gitHead");
  });
});
