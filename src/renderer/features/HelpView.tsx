import { DetailSection } from "../components/RunPage";

export function HelpView() {
  return (
    <div className="detail-sections help-sections">
      <DetailSection
        title="How it works"
        description="Three steps, with you in control of every run and every change."
      >
        <ol className="help-steps">
          <li>
            <span>1</span>
            <div>
              <strong>Choose</strong>
              <small>Pick a test and a sandbox or UAT environment.</small>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>Run visibly</strong>
              <small>Review parameters and approve anything that changes data.</small>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>Review</strong>
              <small>Check status, steps, screenshots, video and the report.</small>
            </div>
          </li>
        </ol>
      </DetailSection>

      <DetailSection
        title="Get started"
        description="Set up one safe test target, once. Takes a few minutes."
      >
        <ol className="help-list">
          <li>
            <strong>Customers</strong>: create the customer and a test group for its application.
          </li>
          <li>
            <strong>Environments</strong>: add a sandbox or UAT target and choose the sign-in mode.
            Store a dedicated test credential; it is never saved in the workspace.
          </li>
          <li>
            <strong>Test library</strong>: import a Page Script YAML recording.
          </li>
          <li>
            Choose <strong>Run</strong> on the test, review the summary and start the run. A browser
            window shows every step.
          </li>
        </ol>
      </DetailSection>

      <DetailSection
        title="Tests and plans"
        description="Reuse single tests, or run several in a fixed order."
      >
        <dl className="help-defs">
          <div>
            <dt>Page Script YAML</dt>
            <dd>A Business Central recording with steps, parameters and optional includes.</dd>
          </div>
          <div>
            <dt>Forbidden actions</dt>
            <dd>Actions a test must never perform, such as posting or sending externally.</dd>
          </div>
          <div>
            <dt>Test plans</dt>
            <dd>
              Run tests in order for one customer and environment. A plan stops at the first
              failure.
            </dd>
          </div>
        </dl>
      </DetailSection>

      <DetailSection title="Results and evidence" description="Everything stays on this device.">
        <dl className="help-defs">
          <div>
            <dt>Run history</dt>
            <dd>
              Status, source, duration, steps and errors for every run. Runs started by an AI agent
              are labelled AI agent.
            </dd>
          </div>
          <div>
            <dt>Failure evidence</dt>
            <dd>Open a run for screenshots, replay video and the Playwright report.</dd>
          </div>
          <div>
            <dt>Export</dt>
            <dd>Export a run as Markdown or JSON. Secrets are masked.</dd>
          </div>
        </dl>
      </DetailSection>

      <DetailSection
        title="When a test fails"
        description="Let your coding agent find the cause in the AL code. You approve before anything changes."
      >
        <ol className="help-list">
          <li>
            Add a <strong>Project</strong> for the environment (Configuration → Projects): the AL
            code folder and your agent. Link tests to it.
          </li>
          <li>
            Open the failed run and choose <strong>Create investigation</strong>. A package with the
            failing step, log and Page Script is built.
          </li>
          <li>
            Hand it to your agent: copy the prompt, or run the agent from Test Suite. The agent
            proposes a plan and cannot edit anything yet.
          </li>
          <li>
            Read the plan and <strong>approve</strong> it, or ask for changes with a note.
          </li>
          <li>
            The agent changes the code on a local branch and never pushes. You publish it to the
            sandbox yourself.
          </li>
          <li>
            Run the <strong>retest</strong>. If it passes, the investigation is verified; if not, a
            new round starts with the new evidence.
          </li>
        </ol>
      </DetailSection>

      <DetailSection
        title="AI agent access"
        description="Let Codex or Claude Desktop use Test Suite through a local connection."
      >
        <ol className="help-list">
          <li>Keep Test Suite open.</li>
          <li>
            Open <strong>Settings → AI agent access</strong> and copy the configuration into your AI
            client.
          </li>
          <li>Restart the client and ask it to look at existing tests before drafting new ones.</li>
          <li>
            Approve or reject create, start and stop requests on the <strong>Dashboard</strong>.
          </li>
        </ol>
        <div className="banner-info">
          An agent sees sanitized examples and results only. It cannot read credentials, overwrite
          tests, approve its own plan or bypass the production block.
        </div>
      </DetailSection>

      <DetailSection
        title="Safety rules"
        description="These cannot be bypassed, not even by an agent."
      >
        <ul className="help-list">
          <li>Production runs are always blocked.</li>
          <li>Tests that can change data need your explicit approval.</li>
          <li>Credentials and remembered sessions stay encrypted by the operating system.</li>
          <li>Imported files are validated before they are stored or run.</li>
          <li>Logs, reports and agent packages are scrubbed of secrets.</li>
        </ul>
      </DetailSection>

      <DetailSection title="Something not working?" description="Check these in order.">
        <ol className="help-list">
          <li>
            Open <strong>Settings → Runtime</strong> and check PowerShell and the replay runtime.
          </li>
          <li>Verify the environment: URL, company, sign-in mode and a stored credential.</li>
          <li>For AI agents, confirm Test Suite is open and restart the AI client.</li>
          <li>Open the failed run and read its activity, screenshot, video and report.</li>
        </ol>
      </DetailSection>

      <DetailSection title="Provided as is" description="Open-source software, without warranty.">
        <div className="banner-info">
          NIVIO Test Suite is provided as is, without warranty of any kind. NIVIO BV is not
          responsible for any problem, damage or loss that results from using it, including changed
          or lost Business Central data and incorrect test results. You use it at your own risk. Run
          it against sandbox or UAT environments only, and review every test before you run it.
        </div>
      </DetailSection>
    </div>
  );
}
