import * as fs from 'fs';
import * as path from 'path';
import * as cdk from '@aws-cdk/core';
import * as codecommit from '@aws-cdk/aws-codecommit';
import * as ecr from '@aws-cdk/aws-ecr';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as codepipeline_actions from '@aws-cdk/aws-codepipeline-actions';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as iam from '@aws-cdk/aws-iam';

class DockerBuildPipelineStack extends cdk.Stack {
  public codeCommitRepository: codecommit.IRepository;
  public ecrRepository: ecr.IRepository;

  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Parameters
    const codePipelineName = new cdk.CfnParameter(this, "CodePipelineName", {
      type: "String",
      allowedPattern: "^[a-zA-Z0-9._-]{1,100}$",
      description: "The name of the pipeline to be created. The provided name would be suffixed with '-DockerPipelineStack'"
    });
    const codeCommitRepositoryName = new cdk.CfnParameter(this, "CodeCommitRepositoryName", {
      type: "String",
      allowedPattern: "^[a-zA-Z0-9._-]{1,100}$",
      description: "The existing CodeCommit repository name."
    });
    const ecrRepositoryName = new cdk.CfnParameter(this, "ECRRepositoryName", {
      type: "String",
      allowedPattern: "^[a-zA-Z0-9/._-]{1,100}$",
      description: "The ECR repository name"
    });


    // Pre-requisites
    this.codeCommitRepository = codecommit.Repository.fromRepositoryName(this, "CodeCommit", codeCommitRepositoryName.valueAsString);
    this.ecrRepository = new ecr.Repository(this, "ECRRepository", {
      repositoryName: ecrRepositoryName.valueAsString,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.MUTABLE,
    });

    // Pipeline definition
    const pipelineSuffixName = 'DockerPipelineStack';
    const pipelineName = codePipelineName.valueAsString;
    const fullPipelineName = `${pipelineName}-${pipelineSuffixName}`;
    const pipeline = new codepipeline.Pipeline(this, "CodePipeline", {
      pipelineName: fullPipelineName,
      crossAccountKeys: false,
    });

    /**
     *  Pipeline Stages
     * */ 
    
    // Source Stage
    const sourceArtifact = new codepipeline.Artifact("SourceArtifact");
    const sourcePipelineStage: codepipeline.StageOptions = {
      stageName: "Source",
      actions: [
        new codepipeline_actions.CodeCommitSourceAction({
          branch: 'master', // default
          trigger: codepipeline_actions.CodeCommitTrigger.EVENTS, // default
          actionName: "CodeCommitSourceAction",
          repository: this.codeCommitRepository,
          output: sourceArtifact,
        })
      ]
    };

    // Build Stage
    const buildArtifact = new codepipeline.Artifact("BuildArtifact");
    const codeBuildProjectName = `${fullPipelineName}-CodeBuild`;
    const codeBuildPipelineProject = new codebuild.PipelineProject(this, "CodeBuild", {
      projectName: codeBuildProjectName,
      checkSecretsInPlainTextEnvVariables: true,
      environment: {
        privileged: true,
      },
      cache: codebuild.Cache.local(codebuild.LocalCacheMode.DOCKER_LAYER, codebuild.LocalCacheMode.CUSTOM),
      environmentVariables: {
        "AWS_DEFAULT_REGION": {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: this.region,
        },
        "AWS_ACCOUNT_ID": {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: this.account,
        },
      },
    });

    const codeBuildECRChangePermission = this.getCodeBuildECRChangePermission();
    const codeBuildECRGetAuthorizationPermission = this.getCodeBuildECRGetAuthorizationPermission();
    const codeBuildECRPullImagesPermission = this.getCodeBuildECRPullImagesPermission();
    codeBuildPipelineProject.addToRolePolicy(codeBuildECRChangePermission);
    codeBuildPipelineProject.addToRolePolicy(codeBuildECRGetAuthorizationPermission);
    codeBuildPipelineProject.addToRolePolicy(codeBuildECRPullImagesPermission);
    
    
    const buildPipelineStage: codepipeline.StageOptions = {
      stageName: "Build",
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: "CodeBuildBuildAction",
          project: codeBuildPipelineProject,
          input: sourceArtifact,
          outputs: [buildArtifact],
        })
      ]
    };

    // Attach stages to CodePipeline
    pipeline.addStage(sourcePipelineStage);
    pipeline.addStage(buildPipelineStage);
  }

  private readJsonFile(filePath: string): Record<string, unknown> {
    const jsonFile = fs.readFileSync(path.join(process.cwd(), filePath));
    const jsonFileString = jsonFile.toString("utf8");
    const json = JSON.parse(jsonFileString);
    return json;
  }

  private getCodeBuildECRChangePermission(): iam.PolicyStatement {
    const json = this.readJsonFile("./assets/CodeBuildECRChangePolicyStatement.json");
    json['Resource'] = this.ecrRepository.repositoryArn;
    return iam.PolicyStatement.fromJson(json);
  }

  private getCodeBuildECRGetAuthorizationPermission(): iam.PolicyStatement {
    const json = this.readJsonFile("./assets/CodeBuildECRGetAuthorizationPolicyStatement.json");
    return iam.PolicyStatement.fromJson(json);
  }

  private getCodeBuildECRPullImagesPermission(): iam.PolicyStatement {
    const json = this.readJsonFile("./assets/CodeBuildECRPullImagesPolicyStatement.json");
    const defaultEcrRepositoryArn = `arn:aws:ecr:${this.region}:${this.account}:repository/*`;
    json['Resource'] = defaultEcrRepositoryArn;
    return iam.PolicyStatement.fromJson(json);
  }
}

export default DockerBuildPipelineStack;