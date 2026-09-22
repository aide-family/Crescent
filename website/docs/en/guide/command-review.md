# Command review

Commands proposed by the Agent pass an independent review before they run. The review explains:

- Why the command is proposed
- Whether it may change system, cluster, file, network, service, credential, or data state
- The risk level
- Whether your approval is required
- The likely impact and recommendation

Clearly read-only checks can be allowed automatically. Mutating or ambiguous commands wait for confirmation.

Typical cases that need a person: deleting files, restarting services, privilege changes, writing files, and editing configuration. The Agent should speed up the investigation, not bypass judgment.

Review happens before the command reaches the terminal. You still see the final command and its output in the visible session.
