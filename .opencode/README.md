# OpenCode Configuration - Pharmacy System

## Overview

This directory contains the OpenCode configuration for the Pharmacy System project. OpenCode is a framework for managing AI agents that specialize in different aspects of software development.

## Configuration Files

### Main Configuration

- **`../opencode.json`** - Main OpenCode configuration file
  - Project metadata
  - Workspace configuration
  - Agent definitions
  - Workflow definitions
  - Code quality standards
  - Integration settings
  - Deployment configuration

### Agent Configurations

Agent-specific documentation and guidelines are located in the `agents/` directory:

1. **`agents/backend.md`** - Backend Developer Agent
   - NestJS API development
   - Business logic implementation
   - Database design and optimization
   - Authentication and authorization

2. **`agents/frontend-pos.md`** - POS Frontend Developer Agent
   - Tauri POS terminal development
   - Offline-first architecture
   - React component development
   - Hardware integration

3. **`agents/frontend-backoffice.md`** - Backoffice Frontend Developer Agent
   - React admin dashboard development
   - Data visualization
   - User management interface
   - Reporting and analytics

4. **`agents/fiscal-engine.md`** - Fiscal Engine Developer Agent
   - DIAN fiscal integration
   - XML processing and validation
   - Digital signatures
   - Tax calculations

5. **`agents/database.md`** - Database Architect Agent
   - PostgreSQL administration
   - Schema design and optimization
   - Migration management
   - Performance tuning

6. **`agents/devops.md`** - DevOps & Infrastructure Agent
   - Docker containerization
   - Kubernetes orchestration
   - CI/CD pipeline management
   - Monitoring and logging

7. **`agents/quality-assurance.md`** - Quality Assurance Agent
   - Testing strategy and implementation
   - Code quality analysis
   - Compliance verification
   - Performance testing

8. **`agents/security.md`** - Security & Compliance Agent
   - Security hardening
   - Regulatory compliance
   - Vulnerability management
   - Audit logging

9. **`agents/documentation.md`** - Documentation Agent
   - Technical documentation
   - API documentation
   - User guides
   - Architecture documentation

## Agent Specializations

### Backend Agent
- **Capabilities**: NestJS, TypeScript, Prisma, PostgreSQL, JWT, Zod validation
- **Responsibilities**: API development, business logic, database design
- **Constraints**: 25-line functions, strict TypeScript, no class-validator
- **Modules**: Auth, Cash Shift, Catalog, Clients, Configuration, Fiscal DIAN, Inventory, Purchases, Reports, Sales & Sync

### POS Frontend Agent
- **Capabilities**: Tauri, React, offline-first, local storage, sync queues
- **Responsibilities**: POS terminal UI, offline synchronization, hardware integration
- **Constraints**: Offline-first mandatory, <100ms interactions, WCAG 2.1 AA
- **Features**: Sales transactions, payment processing, receipt printing, inventory search

### Backoffice Frontend Agent
- **Capabilities**: React, Redux, data visualization, responsive design
- **Responsibilities**: Admin dashboard, data management, reporting
- **Constraints**: Responsive design, <200ms page loads, WCAG 2.1 AA
- **Features**: User management, product catalog, inventory, reports, analytics

### Fiscal Engine Agent
- **Capabilities**: NestJS, XML processing, digital signatures, SOAP integration
- **Responsibilities**: DIAN integration, fiscal document generation, tax calculations
- **Constraints**: DIAN Resolution compliance, IVA accuracy, 5-year retention
- **Features**: Invoice generation, contingency mode, tax reporting

### Database Agent
- **Capabilities**: PostgreSQL, Prisma, query optimization, indexing
- **Responsibilities**: Schema design, migrations, performance tuning
- **Constraints**: PostgreSQL 16, strict referential integrity, <100ms queries
- **Features**: 60+ models, audit logging, data archival

### DevOps Agent
- **Capabilities**: Docker, Kubernetes, CI/CD, monitoring, security
- **Responsibilities**: Deployment, infrastructure, monitoring
- **Constraints**: Zero-downtime deployments, security scanning, cost optimization
- **Features**: Containerization, orchestration, auto-scaling, logging

### QA Agent
- **Capabilities**: Jest, Vitest, Cypress, performance testing, security testing
- **Responsibilities**: Testing, code quality, compliance verification
- **Constraints**: 80% minimum coverage, automated testing, no flaky tests
- **Features**: Unit tests, integration tests, E2E tests, performance tests

### Security Agent
- **Capabilities**: OAuth2, encryption, secret management, vulnerability scanning
- **Responsibilities**: Security hardening, compliance, incident response
- **Constraints**: DIAN compliance, Habeas Data compliance, GDPR compliance
- **Features**: Authentication, encryption, audit logging, rate limiting

### Documentation Agent
- **Capabilities**: Markdown, API documentation, architecture diagrams
- **Responsibilities**: Documentation maintenance, user guides, technical writing
- **Constraints**: English only, Markdown format, tested examples
- **Features**: Project overview, API reference, deployment guides

## Workflows

### Feature Development Workflow

1. **Design Phase** (Backend Agent)
   - Design API endpoints
   - Design database schema
   - Create design document

2. **Database Phase** (Database Agent)
   - Create migrations
   - Validate schema
   - Optimize indexes

3. **Implementation Phase** (Backend Agent)
   - Implement services
   - Create controllers
   - Implement business logic

4. **Testing Phase** (QA Agent)
   - Write unit tests
   - Create integration tests
   - Verify coverage

5. **Security Phase** (Security Agent)
   - Security review
   - Vulnerability scanning
   - Hardening

6. **Frontend Phase** (Frontend Agents)
   - Implement UI components
   - Create forms
   - Implement integration

7. **Documentation Phase** (Documentation Agent)
   - Create API docs
   - Write user guide
   - Update architecture docs

8. **Deployment Phase** (DevOps Agent)
   - Deploy to staging
   - Run health checks
   - Deploy to production

### Bug Fix Workflow

1. **Reproduction** (QA Agent)
   - Reproduce bug
   - Document steps
   - Create test case

2. **Root Cause** (Backend Agent)
   - Identify cause
   - Analyze code
   - Create fix proposal

3. **Implementation** (Backend Agent)
   - Implement fix
   - Write regression test
   - Verify fix

4. **Verification** (QA Agent)
   - Test fix
   - Run regression tests
   - Verify no side effects

5. **Deployment** (DevOps Agent)
   - Deploy fix
   - Monitor metrics
   - Verify in production

### Performance Optimization Workflow

1. **Identification** (DevOps Agent)
   - Profile application
   - Identify bottlenecks
   - Create report

2. **Database Optimization** (Database Agent)
   - Optimize queries
   - Add indexes
   - Benchmark improvements

3. **Application Optimization** (Backend Agent)
   - Optimize code
   - Implement caching
   - Reduce allocations

4. **Testing** (QA Agent)
   - Performance testing
   - Load testing
   - Benchmark results

5. **Deployment** (DevOps Agent)
   - Deploy optimizations
   - Monitor metrics
   - Verify improvements

## Code Quality Standards

### Linting

- **Tool**: ESLint
- **Config**: `.eslintrc.json`
- **Rules**: No console, no debugger, no unused vars, prefer const

### Formatting

- **Tool**: Prettier
- **Config**: `.prettierrc.json`
- **Options**: 2-space indent, single quotes, trailing commas

### Type Checking

- **Tool**: TypeScript
- **Mode**: Strict
- **Options**: No implicit any, strict null checks, no unused locals

### Testing

- **Framework**: Jest / Vitest
- **Minimum Coverage**: 80%
- **Coverage Threshold**: 80% branches, functions, lines, statements

### Security

- **Tools**: Snyk, OWASP ZAP
- **Scan On**: Every commit, every deploy
- **Compliance**: DIAN, Habeas Data, GDPR

## Integrations

### GitHub

- **Repository**: https://github.com/your-org/pharmacy-system
- **Protected Branches**: main, develop
- **Required Reviews**: 2
- **Status Checks**: Required

### Slack (Optional)

- **Notifications**: Deployment, build failures, security alerts
- **Webhook**: Configure in environment

### Jira (Optional)

- **Project Key**: PHARM
- **Issue Types**: Feature, Bug, Task, Epic, Story
- **Integration**: Automatic issue linking in commits

### Datadog (Optional)

- **Monitoring**: Application performance, infrastructure metrics
- **Logging**: Centralized log aggregation
- **Alerting**: Performance alerts, error alerts

## Deployment Environments

### Development

- **Database**: PostgreSQL localhost:5432
- **API URL**: http://localhost:3000
- **Node Env**: development
- **Debug Mode**: Enabled

### Staging

- **Database**: PostgreSQL staging-db:5432
- **API URL**: https://api-staging.pharmacy-system.local
- **Node Env**: staging
- **Debug Mode**: Disabled

### Production

- **Database**: PostgreSQL prod-db:5432
- **API URL**: https://api.pharmacy-system.local
- **Node Env**: production
- **Debug Mode**: Disabled

## Deployment Strategies

- **Backend**: Rolling update
- **Frontend**: Blue-green deployment
- **Database**: Backward-compatible migration

## Monitoring & Alerts

### Metrics

- API response time
- Error rate
- Database query time
- Memory usage
- CPU usage
- Disk usage
- Network throughput

### Alerts

- High Error Rate (>5%)
- Slow API Response (>1000ms)
- Database Connection Pool Exhausted (>90%)
- Memory Usage High (>80%)
- Disk Usage High (>90%)

## Backup & Recovery

- **Frequency**: Daily
- **Retention**: 30 days
- **Targets**: Database, file storage, configuration
- **Recovery Time Objective**: <1 hour
- **Recovery Point Objective**: <1 hour

## Getting Started

### For Backend Developers

1. Read `agents/backend.md`
2. Review `../PROJECT_DOCUMENTATION.md`
3. Set up development environment
4. Start with a feature from the roadmap

### For Frontend Developers (POS)

1. Read `agents/frontend-pos.md`
2. Review `../PROJECT_DOCUMENTATION.md`
3. Set up development environment
4. Start with a UI component

### For Frontend Developers (Backoffice)

1. Read `agents/frontend-backoffice.md`
2. Review `../PROJECT_DOCUMENTATION.md`
3. Set up development environment
4. Start with a dashboard page

### For DevOps Engineers

1. Read `agents/devops.md`
2. Review deployment configuration
3. Set up CI/CD pipeline
4. Configure monitoring and alerting

### For QA Engineers

1. Read `agents/quality-assurance.md`
2. Review testing strategy
3. Set up test environment
4. Start writing test cases

## Best Practices

### Code Review

- All code must be reviewed by at least 2 team members
- Reviews should focus on:
  - Code quality and standards
  - Security implications
  - Performance impact
  - Test coverage
  - Documentation

### Commit Messages

- Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`
- Include issue number: `feat: add product search #123`
- Keep messages concise and descriptive

### Branch Naming

- Feature branches: `feature/description`
- Bug fix branches: `bugfix/description`
- Release branches: `release/version`
- Hotfix branches: `hotfix/description`

### Pull Requests

- Link related issues
- Provide clear description
- Include screenshots for UI changes
- Ensure all checks pass
- Request reviews from relevant agents

## Troubleshooting

### Build Failures

1. Check TypeScript errors: `pnpm typecheck`
2. Check linting errors: `pnpm lint`
3. Check test failures: `pnpm test`
4. Check dependencies: `pnpm install`

### Runtime Errors

1. Check logs: `docker logs container-name`
2. Check database connection: `psql $DATABASE_URL`
3. Check environment variables: `.env` file
4. Check API health: `curl http://localhost:3000/health`

### Performance Issues

1. Profile application: Use DevTools or profiler
2. Check database queries: Enable query logging
3. Check memory usage: Monitor with top or htop
4. Check network requests: Use Network tab in DevTools

## Support & Resources

- **Project Documentation**: `../PROJECT_DOCUMENTATION.md`
- **GitHub Repository**: https://github.com/your-org/pharmacy-system
- **Team Communication**: Slack channel
- **Issue Tracking**: GitHub Issues or Jira
- **Documentation**: Wiki or Gitbook

## Version History

- **v1.0.0** - Initial OpenCode configuration
  - 9 specialized agents
  - 3 domain workflows
  - Complete code quality standards
  - Full deployment configuration

## License

Proprietary - All rights reserved

## Contact

For questions or support regarding OpenCode configuration:
- Contact the development team lead
- Create an issue in the repository
- Review the project documentation
