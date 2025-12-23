from gql import gql


class _WClient:
    PROJECT_FRAGMENT = """fragment ProjectFragment on Project {
        id
        name
        entityName
        createdAt
        isBenchmark
    }"""
    RUN_FRAGMENT = """fragment RunFragment on Run {
        id
        tags
        name
        displayName
        sweepName
        state
        config
        group
        jobType
        commit
        readOnly
        createdAt
        heartbeatAt
        description
        notes
        systemMetrics
        summaryMetrics
        historyLineCount
        user {
            id
            username
            __typename
        }
        project {
            id
            name
            entityName
            __typename
        }
        groupCounts
        __typename
        historyKeys
    }"""
    RUNS_TABLE_FRAGMENT = """fragment RunsTableFragment on Run {
        id
        name
        displayName
        state
        createdAt
        heartbeatAt
        updatedAt
        user {
            id
            username
            __typename
        }
        project {
            id
            name
            entityName
            __typename
        }
        groupCounts
        __typename
    }"""
    ARTIFACT_COUNTS_FRAGMENT = """fragment ArtifactCountsFragment on Run {
        inputArtifacts {
            totalCount
            __typename
        }
        outputArtifacts {
            totalCount
            __typename
        }
        __typename
    }"""
    FILE_FRAGMENT = """fragment RunFilesFragment on Run {
        files(names: $fileNames, after: $fileCursor, first: $fileLimit) {
            edges {
                node {
                    id
                    name
                    url(upload: $upload)
                    directUrl
                    sizeBytes
                    mimetype
                    updatedAt
                    md5
                }
                cursor
            }
            pageInfo {
                endCursor
                hasNextPage
            }
        }
    }"""

    def __init__(self, client):
        self.client = client

    def viewer(self, include_storage=False):  # web
        return self.client.execute(
            gql(
                """
                query Viewer($includeStorage: Boolean = false) {
                  viewer {
                    id
                    analyticsId
                    admin
                    email
                    entity
                    defaultFramework
                    photoUrl
                    flags
                    code
                    username
                    createdAt
                    name
                    accountType
                    userInfo
                    hideTeamsFromPublic
                    limits
                    signupRequired
                    personalEntityDisabled
                    instanceAdminTeamAccessDisabled
                    teams(first: 100) {
                      edges {
                        node {
                          id
                          name
                          photoUrl
                          defaultAccess
                          readOnlyAdmin
                          privateOnly
                          isTeam
                          organizationId
                          __typename
                        }
                        __typename
                      }
                      __typename
                    }
                    organizations {
                      id
                      name
                      orgType
                      subscriptions {
                        id
                        subscriptionType
                        __typename
                      }
                      __typename
                    }
                    defaultEntity {
                      id
                      name
                      __typename
                    }
                    userEntity {
                      id
                      name
                      defaultAccess
                      codeSavingEnabled
                      storageBytes @include(if: $includeStorage)
                      settings {
                        defaultCloudRegion {
                          id
                          provider
                          region
                          __typename
                        }
                        __typename
                      }
                      isTeam
                      defaultAlerts {
                        id
                        condition {
                          __typename
                          ... on FinishedRunCondition {
                            success
                            __typename
                          }
                          ... on StoppedRunCondition {
                            minimumRunDuration
                            __typename
                          }
                        }
                        subscriptions {
                          __typename
                          ... on EmailSubscription {
                            id
                            __typename
                          }
                          ... on SlackChannelSubscription {
                            id
                            __typename
                          }
                        }
                        __typename
                      }
                      integrations {
                        edges {
                          node {
                            id
                            __typename
                            ... on SlackIntegration {
                              teamName
                              channelName
                              __typename
                            }
                          }
                          __typename
                        }
                        __typename
                      }
                      claimedEntities {
                        edges {
                          node {
                            id
                            name
                            __typename
                          }
                          __typename
                        }
                        __typename
                      }
                      __typename
                    }
                    __typename
                  }
                }
                """
            ),
            variable_values={"includeStorage": include_storage},
        )

    def viewer_api_keys(self):  # web
        return self.client.execute(
            gql(
                """
                query ViewerApiKeys {
                  viewer {
                    id
                    apiKeys {
                      edges {
                        node {
                          id
                          name
                          __typename
                        }
                        __typename
                      }
                      __typename
                    }
                    __typename
                  }
                }
                """
            )
        )

    def delete_api_key(self, api_key_id):  # web
        return self.client.execute(
            gql(
                """
                mutation DeleteApiKey($id: String!) {
                  deleteApiKey(input: {id: $id}) {
                    success
                    __typename
                  }
                }
                """
            ),
            variable_values={"id": api_key_id},
        )

    def team_page(self, entity_name, workflows_admin_type="MODEL"):  # web
        return self.client.execute(
            gql(
                """
                query TeamPage($entityName: String!, $workflowsAdminType: WorkflowsAdminType!) {
                    entity(name: $entityName) {
                        available
                        claimingEntity {
                            id
                            name
                        }
                        id
                        isTeam
                        members {
                            id
                            admin
                            pending
                            email
                            username
                            name
                            photoUrl
                            accountType
                            apiKey
                            role
                            memberRole {
                                ID
                                name
                            }
                        }
                        memberCount
                        name
                        organizationId
                        invites {
                            edges {
                                node {
                                    id
                                    email
                                    fromUser {
                                        id
                                        username
                                    }
                                }
                            }
                        }
                        photoUrl
                        projects(first: 1) {
                            edges {
                                node {
                                    id
                                }
                            }
                        }
                        projectCount
                        readOnly
                        workflowsAdmins(adminType: $workflowsAdminType) {
                            id
                            username
                            name
                            email
                        }
                        protectedAliases(adminType: $workflowsAdminType)
                    }
                }
                """
            ),
            variable_values={
                "entityName": entity_name,
                "workflowsAdminType": workflows_admin_type,
            },
        )

    def delete_model(self, model_id):  # web
        return self.client.execute(
            gql(
                """
                mutation deleteModel($id: String!) {
                    deleteModel(input: {id: $id}) {
                        success
                        __typename
                    }
                }
                """
            ),
            variable_values={"id": model_id},
        )

    def entity_runs(self, entity_name):  # web
        return self.client.execute(
            gql(
                """
                query EntityRuns($entityName: String!) {
                    entity(name: $entityName) {
                        id
                        latestRuns {
                            edges {
                                node {
                                    id
                                    ...RunsTableFragment
                                    __typename
                                }
                                __typename
                            }
                            __typename
                        }
                        __typename
                    }
                }
                """
                + self.RUNS_TABLE_FRAGMENT
            ),
            variable_values={"entityName": entity_name},
        )

    def run_full_history(self, project, entity, name, samples, min_step=None, max_step=None):  # web
        return self.client.execute(
            gql(
                """
                query RunFullHistory($project: String!, $entity: String!, $name: String!, $samples: Int, $minStep: Int64, $maxStep: Int64) {
                    project(name: $project, entityName: $entity) {
                        run(name: $name) {
                            history(samples: $samples, minStep: $minStep, maxStep: $maxStep)
                        }
                    }
                }
                """
            ),
            variable_values={
                "project": project,
                "entity": entity,
                "name": name,
                "samples": samples,
                "minStep": min_step,
                "maxStep": max_step,
            },
        )

    def runs(
        self,
        project,
        entity,
        cursor=None,
        per_page=None,
        order="+created_at",
        filters="{}",
    ):  # py
        return self.client.execute(
            gql(
                """
                query Runs($project: String!, $entity: String!, $cursor: String, $perPage: Int, $order: String, $filters: JSONString) {
                  project(name: $project, entityName: $entity) {
                    internalId
                    runCount(filters: $filters)
                    readOnly
                    runs(filters: $filters, after: $cursor, first: $perPage, order: $order) {
                      edges {
                        node {
                          ...RunFragment
                        }
                        cursor
                      }
                      pageInfo {
                        endCursor
                        hasNextPage
                      }
                    }
                  }
                }
                """
                + self.RUN_FRAGMENT
            ),
            variable_values={
                "project": project,
                "entity": entity,
                "cursor": cursor,
                "perPage": per_page,
                "order": order,
                "filters": filters,
            },
        )

    def projects(self, entity=None, cursor=None, per_page=None):  # py
        return self.client.execute(
            gql(
                """
                query Projects($entity: String, $cursor: String, $perPage: Int) {
                    models(entityName: $entity, after: $cursor, first: $perPage) {
                        edges {
                            node {
                                ...ProjectFragment
                            }
                            cursor
                        }
                        pageInfo {
                            endCursor
                            hasNextPage
                        }
                    }
                }
                """
                + self.PROJECT_FRAGMENT
            ),
            variable_values={"entity": entity, "perPage": per_page, "cursor": cursor},
        )

    def run(
        self, project_name, entity_name, run_name, enable_artifact_counts=True
    ):  # web
        return self.client.execute(
            gql(
                """
                query Run($projectName: String!, $entityName: String, $runName: String!, $enableArtifactCounts: Boolean = false) {
                  project(name: $projectName, entityName: $entityName) {
                    id
                    name
                    readOnly
                    createdAt
                    access
                    views
                    entityName
                    tags {
                      id
                      name
                      colorIndex
                      __typename
                    }
                    isBenchmark
                    linkedBenchmark {
                      id
                      entityName
                      name
                      gitHubSubmissionRepo
                      views
                      __typename
                    }
                    run(name: $runName) {
                      id
                      name
                      displayName
                      notes
                      config
                      summaryMetrics
                      historyKeys(format: PLAINTEXT)
                      github
                      fileCount
                      createdAt
                      heartbeatAt
                      computeSeconds
                      commit
                      jobType
                      group
                      tags: tagColors {
                        id
                        name
                        colorIndex
                        __typename
                      }
                      host
                      state
                      stopped
                      sweep {
                        id
                        name
                        displayName
                        __typename
                      }
                      runInfo {
                        program
                        args
                        os
                        python
                        colab
                        executable
                        codeSaved
                        cpuCount
                        cpuCountLogical
                        gpuCount
                        gpu
                        git {
                          remote
                          commit
                          __typename
                        }
                        __typename
                      }
                      diffPatchFile: files(first: 1, names: ["diff.patch"]) {
                        edges {
                          node {
                            id
                            name
                            md5
                            sizeBytes
                            __typename
                          }
                          __typename
                        }
                        __typename
                      }
                      metadataFile: files(first: 1, names: ["metadata.json"]) {
                        edges {
                          node {
                            id
                            name
                            md5
                            sizeBytes
                            directUrl
                            __typename
                          }
                          __typename
                        }
                        __typename
                      }
                      ...ArtifactCountsFragment @include(if: $enableArtifactCounts)
                      logLineCount
                      outputLogFile: files(first: 1, names: ["output.log"]) {
                        edges {
                          node {
                            id
                            name
                            md5
                            sizeBytes
                            directUrl
                            url(upload: false)
                            __typename
                          }
                          __typename
                        }
                        __typename
                      }
                      benchmarkRun {
                        id
                        benchmark {
                          id
                          name
                          entityName
                          readOnly
                          views
                          __typename
                        }
                        details
                        results
                        gitHubSubmissionPR
                        run {
                          id
                          name
                          github
                          user {
                            id
                            username
                            __typename
                          }
                          summaryMetrics
                          __typename
                        }
                        originalProject {
                          id
                          name
                          entityName
                          __typename
                        }
                        originalRun {
                          id
                          name
                          __typename
                        }
                        isCodeHidden
                        state
                        __typename
                      }
                      user {
                        id
                        username
                        name
                        photoUrl
                        accountType
                        __typename
                      }
                      servicesAvailable {
                        tensorboard
                        __typename
                      }
                      branchPoint {
                        run {
                          id
                          name
                          project {
                            id
                            name
                            entity {
                              id
                              name
                              __typename
                            }
                            __typename
                          }
                          __typename
                        }
                        step
                        __typename
                      }
                      internalID
                      __typename
                    }
                    entity {
                      id
                      name
                      defaultAccess
                      readOnlyAdmin
                      privateOnly
                      isTeam
                      user {
                        id
                        username
                        accountType
                        __typename
                      }
                      claimingEntity {
                        id
                        name
                        __typename
                      }
                      codeSavingEnabled
                      __typename
                    }
                    __typename
                  }
                }
                """
                + self.ARTIFACT_COUNTS_FRAGMENT
            ),
            variable_values={
                "projectName": project_name,
                "entityName": entity_name,
                "runName": run_name,
                "enableArtifactCounts": enable_artifact_counts,
            },
        )

    def run_log_lines(self, project_name, entity_name, run_name):  # web
        return self.client.execute(
            gql(
                """
                query RunLogLines($projectName: String!, $entityName: String, $runName: String!) {
                  project(name: $projectName, entityName: $entityName) {
                    id
                    run(name: $runName) {
                      id
                      logLines(last: 10000) {
                        edges {
                          node {
                            id
                            line
                            level
                            label
                            timestamp
                            __typename
                          }
                          __typename
                        }
                        __typename
                      }
                      __typename
                    }
                    __typename
                  }
                }
                """
            ),
            variable_values={
                "projectName": project_name,
                "entityName": entity_name,
                "runName": run_name,
            },
        )

    def organization_subscription_info(self, organization_id):  # web
        return self.client.execute(
            gql(
                """
                query OrganizationSubscriptionInfo($organizationId: ID!) {
                  organization(id: $organizationId) {
                    id
                    name
                    orgType
                    flags
                    usedSeats
                    usedViewOnlySeats
                    createdAt
                    seatAvailability {
                      seats
                      viewOnlySeats
                      __typename
                    }
                    stripeBillingInfo {
                      status
                      cancelAtPeriodEnd
                      currentPeriodEnd
                      invoiceLink
                      paymentMethod {
                        id
                        type
                        cardType
                        endingIn
                        __typename
                      }
                      paymentMetadata {
                        shouldUpgradeToTeams
                        __typename
                      }
                      __typename
                    }
                    stripePaymentMethods {
                      stripePaymentMethodID
                      type
                      isDefault
                      isFailed
                      card {
                        last4
                        brand
                        __typename
                      }
                      __typename
                    }
                    stripeInvoices {
                      number
                      created
                      total
                      status
                      currency
                      hostedInvoiceURL
                      invoicePDF
                      subscription {
                        status
                        organizationSubscriptions {
                          id
                          plan {
                            id
                            displayName
                            __typename
                          }
                          __typename
                        }
                        __typename
                      }
                      __typename
                    }
                    billingUser {
                      id
                      username
                      name
                      email
                      photoUrl
                      stripeCustomerId
                      __typename
                    }
                    stripeCustomerId
                    teams {
                      id
                      name
                      memberCount
                      photoUrl
                      __typename
                    }
                    subscriptions {
                      id
                      plan {
                        id
                        name
                        unitPrice
                        billingInterval
                        planType
                        maxSeats
                        displayName
                        defaultPrivileges
                        stripePrice {
                          amount
                          __typename
                        }
                        __typename
                      }
                      privileges
                      seats
                      expiresAt
                      subscriptionType
                      status
                      nextPlans {
                        id
                        name
                        displayName
                        billingInterval
                        defaultPrivileges
                        stripePrice {
                          amount
                          __typename
                        }
                        __typename
                      }
                      availableSeatsToPurchase
                      isAutomaticUpgrade
                      thresholdCrossedAt
                      upgradedAt
                      billingPeriodStart
                      billingPeriodEnd
                      __typename
                    }
                    members {
                      orgID
                      id
                      username
                      name
                      photoUrl
                      admin
                      email
                      user {
                        id
                        loggedInAt
                        __typename
                      }
                      teams {
                        edges {
                          node {
                            id
                            name
                            __typename
                          }
                          __typename
                        }
                        __typename
                      }
                      role
                      modelsSeat
                      weaveRole
                      __typename
                    }
                    pendingInvites {
                      id
                      email
                      entity {
                        id
                        name
                        __typename
                      }
                      role
                      createdAt
                      __typename
                    }
                    __typename
                  }
                }
                """
            ),
            variable_values={"organizationId": organization_id},
        )

    def generate_api_key(self, description=None):  # web
        return self.client.execute(
            gql(
                """
                mutation GenerateApiKey($description: String) {
                  generateApiKey(input: {description: $description}) {
                    apiKey {
                      id
                      name
                      __typename
                    }
                    __typename
                  }
                }
                """
            ),
            variable_values={"description": description},
        )

    def run_files(
        self,
        project,
        entity,
        name,
        file_cursor=None,
        file_limit=None,
        file_names=None,
        upload=False,
    ):  # web
        return self.client.execute(
            gql(
                """
                query RunFiles($project: String!, $entity: String!, $name: String!, $fileCursor: String,
                    $fileLimit: Int, $fileNames: [String] = [], $upload: Boolean = false) {
                    project(name: $project, entityName: $entity) {
                        internalId
                        run(name: $name) {
                            fileCount
                            ...RunFilesFragment
                        }
                    }
                }
                """
                + self.FILE_FRAGMENT
            ),
            variable_values={
                "project": project,
                "entity": entity,
                "name": name,
                "fileCursor": file_cursor,
                "fileLimit": file_limit,
                "fileNames": file_names if file_names is not None else [],
                "upload": upload,
            },
        )

    def bucketed_runs_delta_query(
        self,
        project_name,
        entity_name,
        bucketed_history_specs,
        filters="{}",
        enable_basic=True,
        enable_config=True,
        enable_summary=True,
        config_keys=None,
        group_keys=None,
        group_level=0,
        internal_id="",
        limit=1,
        order="+createdAt",
        summary_keys=None,
        current_runs=None,
        last_updated="1970-01-01T00:00:00.000Z",
    ):  # web
        return self.client.execute(
            gql(
                """
                query BucketedRunsDeltaQuery($bucketedHistorySpecs: [JSONString!]!, $configKeys: [String!], $currentRuns: [String!]!, $enableBasic: Boolean = true, $enableConfig: Boolean = false, $enableSummary: Boolean = false, $entityName: String!, $filters: JSONString!, $groupKeys: [String!]!, $groupLevel: Int!, $lastUpdated: DateTime!, $limit: Int!, $order: String!, $projectName: String!, $summaryKeys: [String!]) {
                  project(name: $projectName, entityName: $entityName) {
                    id
                    ...DeltaQueryFragment
                    __typename
                  }
                }
                
                fragment DeltaQueryFragment on Project {
                  entityName
                  name
                  runs(
                    first: $limit
                    order: $order
                    filters: $filters
                    groupKeys: $groupKeys
                    groupLevel: $groupLevel
                  ) {
                    deltas(currentRuns: $currentRuns, lastUpdated: $lastUpdated) {
                      order
                      delta {
                        op
                        run {
                          ...RunStateBasicFragment @include(if: $enableBasic)
                          bucketedHistory(specs: $bucketedHistorySpecs, packVersion: 1)
                          config(keys: $configKeys) @include(if: $enableConfig)
                          defaultColorIndex
                          displayName
                          id
                          name
                          projectId
                          summaryMetrics(keys: $summaryKeys) @include(if: $enableSummary)
                          updatedAt
                          __typename
                        }
                        __typename
                      }
                      __typename
                    }
                    __typename
                  }
                  __typename
                }
                
                fragment RunStateBasicFragment on Run {
                  agent {
                    id
                    name
                    __typename
                  }
                  benchmarkRun {
                    id
                    __typename
                  }
                  commit
                  computeSeconds
                  createdAt
                  defaultColorIndex
                  displayName
                  framework
                  github
                  group
                  groupCounts
                  heartbeatAt
                  host
                  jobType
                  logLineCount
                  notes
                  pendingUpdates
                  projectId
                  readOnly
                  runInfo {
                    gpu
                    gpuCount
                    codePath
                    __typename
                  }
                  shouldStop
                  state
                  stopped
                  sweep {
                    id
                    name
                    displayName
                    __typename
                  }
                  user {
                    id
                    username
                    photoUrl
                    __typename
                  }
                  __typename
                }
                """
            ),
            variable_values={
                "projectName": project_name,
                "entityName": entity_name,
                "bucketedHistorySpecs": bucketed_history_specs,
                "configKeys": config_keys if config_keys is not None else [],
                "currentRuns": current_runs if current_runs is not None else [],
                "enableBasic": enable_basic,
                "enableConfig": enable_config,
                "enableSummary": enable_summary,
                "filters": filters,
                "groupKeys": group_keys if group_keys is not None else [],
                "groupLevel": group_level,
                "lastUpdated": last_updated,
                "limit": limit,
                "order": order,
                "summaryKeys": summary_keys if summary_keys is not None else [],
            },
        )

    def history_page(
        self,
        entity,
        project,
        run,
        min_step,
        max_step,
        page_size
    ):  # web
        return self.client.execute(
            gql(
                """
                query HistoryPage($entity: String!, $project: String!, $run: String!, $minStep: Int64!, $maxStep: Int64!, $pageSize: Int!) {
                    project(name: $project, entityName: $entity) {
                        run(name: $run) {
                            history(minStep: $minStep, maxStep: $maxStep, samples: $pageSize)
                        }
                    }
                }
                """
            ),
            variable_values={
                "entity": entity,
                "project": project,
                "run": run,
                "minStep": min_step,
                "maxStep": max_step,
                "pageSize": page_size,
            },
        )

    def direct_url_query(
        self,
        entity_name,
        project_name,
        run_name,
        filenames
    ):  # web
        return self.client.execute(
            gql(
                """
                query DirectUrlQuery($projectName: String!, $entityName: String!, $runName: String!, $filenames: [String!]!) {
                  project(entityName: $entityName, name: $projectName) {
                    id
                    run(name: $runName) {
                      id
                      files(names: $filenames) {
                        edges {
                          node {
                            id
                            name
                            directUrl
                            url(upload: false)
                            __typename
                          }
                          __typename
                        }
                        __typename
                      }
                      __typename
                    }
                    __typename
                  }
                }
                """
            ),
            variable_values={
                "entityName": entity_name,
                "projectName": project_name,
                "runName": run_name,
                "filenames": filenames,
            },
        )

    def run_state_delta_query(
        self,
        project_name,
        entity_name,
        filters,
        sampled_history_specs,
        enable_aggregations=False,
        enable_artifact_counts=False,
        enable_basic=False,
        enable_config=False,
        enable_history_key_info=False,
        enable_sampled_history=True,
        enable_summary=False,
        enable_system_metrics=True,
        enable_tags=True,
        aggregation_keys=None,
        config_keys=None,
        group_keys=None,
        group_level=0,
        limit=10,
        order="+createdAt",
        summary_keys=None,
        current_runs=None,
        last_updated="1970-01-01T00:00:00.000Z",
    ):  # web
        return self.client.execute(
            gql(
                """
                query RunsStateDeltaQuery($aggregationKeys: [String!], $configKeys: [String!], $currentRuns: [String!]!, $enableAggregations: Boolean = false, $enableArtifactCounts: Boolean = false, $enableBasic: Boolean = true, $enableConfig: Boolean = false, $enableHistoryKeyInfo: Boolean = false, $enableSampledHistory: Boolean = false, $enableSummary: Boolean = false, $enableSystemMetrics: Boolean = true, $enableTags: Boolean = true, $entityName: String!, $filters: JSONString!, $groupKeys: [String!]!, $groupLevel: Int!, $lastUpdated: DateTime!, $limit: Int!, $order: String!, $projectName: String!, $sampledHistorySpecs: [JSONString!]!, $summaryKeys: [String!]) {
                  project(name: $projectName, entityName: $entityName) {
                    id
                    runs(
                      first: $limit
                      order: $order
                      filters: $filters
                      groupKeys: $groupKeys
                      groupLevel: $groupLevel
                    ) {
                      totalCount
                      delta(currentRuns: $currentRuns, lastUpdated: $lastUpdated) {
                        index
                        op
                        run {
                          id
                          name
                          projectId
                          displayName
                          updatedAt
                          ...ArtifactCountsFragment @include(if: $enableArtifactCounts)
                          ...RunStateBasicFragment @include(if: $enableBasic)
                          aggregations(keys: $aggregationKeys) @include(if: $enableAggregations)
                          config(keys: $configKeys) @include(if: $enableConfig)
                          historyKeys(format: PLAINTEXT) @include(if: $enableHistoryKeyInfo)
                          sampledHistory(specs: $sampledHistorySpecs, packVersion: 1) @include(if: $enableSampledHistory)
                          summaryMetrics(keys: $summaryKeys) @include(if: $enableSummary)
                          systemMetrics @include(if: $enableSystemMetrics)
                          tags: tagColors @include(if: $enableTags) {
                            id
                            name
                            colorIndex
                            __typename
                          }
                          __typename
                        }
                        __typename
                      }
                      __typename
                    }
                    __typename
                  }
                }

                fragment ArtifactCountsFragment on Run {
                  inputArtifacts {
                    totalCount
                    __typename
                  }
                  outputArtifacts {
                    totalCount
                    __typename
                  }
                  __typename
                }

                fragment RunStateBasicFragment on Run {
                  agent {
                    id
                    name
                    __typename
                  }
                  benchmarkRun {
                    id
                    __typename
                  }
                  commit
                  computeSeconds
                  createdAt
                  defaultColorIndex
                  displayName
                  framework
                  github
                  group
                  groupCounts
                  heartbeatAt
                  host
                  jobType
                  logLineCount
                  notes
                  pendingUpdates
                  projectId
                  readOnly
                  runInfo {
                    gpu
                    gpuCount
                    codePath
                    __typename
                  }
                  shouldStop
                  state
                  stopped
                  sweep {
                    id
                    name
                    displayName
                    __typename
                  }
                  user {
                    id
                    username
                    photoUrl
                    __typename
                  }
                  __typename
                }
                """
            ),
            variable_values={
                "projectName": project_name,
                "entityName": entity_name,
                "filters": filters,
                "sampledHistorySpecs": sampled_history_specs,
                "enableAggregations": enable_aggregations,
                "enableArtifactCounts": enable_artifact_counts,
                "enableBasic": enable_basic,
                "enableConfig": enable_config,
                "enableHistoryKeyInfo": enable_history_key_info,
                "enableSampledHistory": enable_sampled_history,
                "enableSummary": enable_summary,
                "enableSystemMetrics": enable_system_metrics,
                "enableTags": enable_tags,
                "aggregationKeys": aggregation_keys if aggregation_keys is not None else [],
                "configKeys": config_keys if config_keys is not None else [],
                "groupKeys": group_keys if group_keys is not None else [],
                "groupLevel": group_level,
                "limit": limit,
                "order": order,
                "summaryKeys": summary_keys if summary_keys is not None else [],
                "currentRuns": current_runs if current_runs is not None else [],
                "lastUpdated": last_updated,
            },
        )

    def run_system_metrics(
        self,
        project_name,
        entity_name,
        run_name,
        samples=1000
    ):  # web
        return self.client.execute(
            gql(
                """
                query RunSystemMetrics($projectName: String!, $entityName: String, $runName: String!, $samples: Int!) {
                  project(name: $projectName, entityName: $entityName) {
                    id
                    run(name: $runName) {
                      id
                      events(samples: $samples)
                      __typename
                    }
                    __typename
                  }
                }
                """
            ),
            variable_values={
                "projectName": project_name,
                "entityName": entity_name,
                "runName": run_name,
                "samples": samples,
            },
        )
