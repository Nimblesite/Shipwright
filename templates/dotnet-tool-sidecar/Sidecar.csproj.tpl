<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net9.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <PackageId>{{PACKAGE_ID}}</PackageId>
    <Version>{{VERSION}}</Version>
    <PackAsTool>true</PackAsTool>
    <ToolCommandName>{{COMMAND_NAME}}</ToolCommandName>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="DeployToolkit" Version="0.1.0" />
  </ItemGroup>
</Project>
