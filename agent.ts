const dotenv = require("dotenv");
dotenv.config();

const { TavilySearch } = require("@langchain/tavily");
const { ChatGroq } = require("@langchain/groq");
const { Annotation } = require("@langchain/langgraph");
const { HumanMessage, AIMessage, BaseMessage } = require("@langchain/core/messages");
const { StateGraph, END, START } = require("@langchain/langgraph");
const { enrichCompanyTool } = require("./tools");

// Verify required environment variables
function validateEnvironment(): void {
  const requiredVars = ['GROQ_API_KEY', 'TAVILY_API_KEY', 'APOLLO_API_KEY'];
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

// Validate domain format
function validateDomain(domain: string): boolean {
  const DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;
  return DOMAIN_REGEX.test(domain);
}

// Build the company enrichment agent
async function buildCompanyEnrichmentAgent() {
  try {
    validateEnvironment();
  } catch (error) {
    console.error("Environment validation failed:", error);
    process.exit(1);
  }

  // Create tools
  const searchTool = new TavilySearch({ maxResults: 6 });
  const enrichCompany = enrichCompanyTool();
  const model = new ChatGroq({ 
    apiKey: process.env.GROQ_API_KEY,
    model: "llama-3.3-70b-versatile",
  });

  // Define state handlers
  async function processQuery(state: any): Promise<any> {
    try {
      const lastMessage = state.messages[state.messages.length - 1];

      if (!lastMessage?.content || typeof lastMessage.content !== "string") {
        throw new Error("Invalid message content");
      }

      // Extract company domain using LLM
      const response = await model.invoke([
        new HumanMessage(`Extract just the company domain from this query: "${lastMessage.content}"
        Only return the domain without any explanation or additional text.
        If no clear domain is found, return "invalid".
        Examples:
        - "Leads for c2fo.com" -> "c2fo.com"
        - "Find managers at google.com" -> "google.com"
        - "Company info for microsoft" -> "invalid"`)
      ]);

      const domain = response.content.toString().trim().toLowerCase();

      if (domain === "invalid" || !validateDomain(domain)) {
        throw new Error("Could not extract valid company domain");
      }

      return {
        companyDomain: domain,
        currentStep: "enrich",
      };
    } catch (error) {
      console.error("Error in processQuery:", error);
      return {
        error: error instanceof Error ? error.message : "Could not extract company name",
        currentStep: "end",
      };
    }
  }

  // Enrich company data with Apollo
  async function enrichCompanyData(state: any): Promise<any> {
    try {
      if (!state.companyDomain) {
        throw new Error("No company domain available");
      }

      if (!validateDomain(state.companyDomain)) {
        throw new Error("Invalid domain format");
      }

      console.log(`Enriching company data for domain: ${state.companyDomain}`);
      const companyDataRaw = await enrichCompany.invoke({
        domain: state.companyDomain,
      });

      let companyData: any;
      try {
        const parsed = JSON.parse(companyDataRaw);
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        companyData = parsed;
      } catch (parseError) {
        throw new Error("Failed to parse company data");
      }

      if (!companyData.name) {
        throw new Error("Company data missing required fields");
      }

      console.log(`Successfully enriched data for: ${companyData.name}`);
      return {
        companyInfo: companyData,
        currentStep: "search_managers",
      };
    } catch (error) {
      console.error("Error in enrichCompanyData:", error);
      return {
        error: error instanceof Error ? error.message : "Failed to enrich company data",
        currentStep: "end",
      };
    }
  }

  // Search for manager leads
  async function searchManagerLeads(state: any): Promise<any> {
    try {
      if (!state.companyInfo?.name) {
        throw new Error("No company name provided");
      }

      const searchQuery = `CTO OR Head of Engineering OR VP Engineering at ${state.companyInfo.name} site:linkedin.com`;
      console.log(`Searching for managers with query: ${searchQuery}`);
      
      const searchResponse = await searchTool.invoke({ query: searchQuery });
      
      if (!searchResponse.results || searchResponse.results.length === 0) {
        console.warn("No search results found for managers");
        return {
          leads: [],
          currentStep: "summarize",
        };
      }

      console.log("Search results for managers:", searchResponse.results.length, "results");

      const llmResponse = await model.invoke([
        new HumanMessage(`
          You must respond with ONLY a valid JSON array. Do not include any other text, explanations, or formatting.
          
          Extract LinkedIn profiles from these search results and return them as a JSON array with this exact format:
          [
            {
              "name": "Full Name",
              "linkedin": "https://linkedin.com/in/username",
              "role": "Engineering Manager"
            }
          ]
          
          Only include results that appear to be actual LinkedIn profiles of engineering managers, VPs, or heads of engineering.
          If no valid profiles are found, return an empty array: []
          
          Search results:
          ${JSON.stringify(searchResponse.results, null, 2)}
        `)
      ]);

      let leads: any[] = [];
      try {
        const content = llmResponse.content.toString().trim();
        console.log("LLM Response:", content);
        
        // Try to extract JSON from the response if it's wrapped in other text
        let jsonContent = content;
        
        // Look for JSON array pattern
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          jsonContent = jsonMatch[0];
        }
        
        const parsed = JSON.parse(jsonContent);
        if (Array.isArray(parsed)) {
          leads = parsed.map(lead => ({
            name: lead.name || "Unknown",
            role: lead.role || "Unknown",
            linkedin: lead.linkedin || lead.linkedin_url || "",
            email: lead.email || undefined
          }));
        }
      } catch (parseError) {
        console.warn("Failed to parse leads from LLM response:", parseError);
        console.log("Raw LLM response:", llmResponse.content);
        
        // Fallback: create basic lead structure from search results
        leads = searchResponse.results.slice(0, 3).map((result: any, index: number) => ({
          name: `Manager ${index + 1}`,
          role: "Engineering Manager",
          linkedin: result.url,
          email: undefined
        }));
      }

      console.log(`Found ${leads.length} potential leads`);
      return {
        leads,
        currentStep: "summarize",
      };
    } catch (error) {
      console.error("Error in searchManagerLeads:", error);
      return {
        error: error instanceof Error ? error.message : "Failed to search for manager leads",
        currentStep: "end",
      };
    }
  }

  // Summarize the findings
  async function summarizeFindings(state: any): Promise<any> {
    try {
      const companyInfo = state.companyInfo;
      const companyName = companyInfo?.name;
      const companyDomain = state.companyDomain;
      const leads = state.leads || [];

      if (!companyInfo || !companyName) {
        throw new Error("Missing company information for summary");
      }

      const summaryPrompt = `Create a comprehensive summary of ${companyName} (domain: ${companyDomain}) based on this information:
      
      Company Information:
      - Name: ${companyInfo.name}
      - Industry: ${companyInfo.industry || 'Not specified'}
      - Founded: ${companyInfo.founded_year || 'Not specified'}
      - Employees: ${companyInfo.estimated_num_employees || 'Not specified'}
      - Location: ${companyInfo.city}, ${companyInfo.state}, ${companyInfo.country}
      - Revenue: ${companyInfo.annual_revenue_printed || companyInfo.organization_revenue_printed || 'Not disclosed'}
      - Total Funding: ${companyInfo.total_funding_printed || 'Not disclosed'}
      - Latest Funding Stage: ${companyInfo.latest_funding_stage || 'Not specified'}
      - Website: ${companyInfo.website_url || companyInfo.primary_domain}
      - LinkedIn: ${companyInfo.linkedin_url || 'Not available'}
      - Description: ${companyInfo.short_description || 'Not available'}
      
      Engineering Department:
      - Engineering Headcount: ${companyInfo.departmental_head_count?.engineering || 'Not specified'}
      - Data Science Headcount: ${companyInfo.departmental_head_count?.data_science || 'Not specified'}
      - Product Management Headcount: ${companyInfo.departmental_head_count?.product_management || 'Not specified'}
      
      Technology Stack:
      ${companyInfo.technology_names ? companyInfo.technology_names.join(', ') : 'Not specified'}
      
      Potential Engineering Leads Found: ${leads.length}
      ${leads.length > 0 ? leads.map(lead => `- ${lead.name} (${lead.role}) - ${lead.linkedin}`).join('\n') : 'No leads found'}
      
      Please create a professional summary that includes:
      1. Company overview and business model
      2. Engineering team size and structure
      3. Technology stack and capabilities
      4. Financial health and growth stage
      5. Potential engineering contacts found
      6. Key insights for outreach
      
      Format the response in a clean, readable way suitable for business development.`;

      const summary = await model.invoke([new HumanMessage(summaryPrompt)]);

      return {
        messages: [...state.messages, summary],
        currentStep: "end",
      };
    } catch (error) {
      console.error("Error in summarizeFindings:", error);
      return {
        error: error instanceof Error ? error.message : "Failed to generate summary",
        currentStep: "end",
      };
    }
  }

  // Create the graph
  const StateAnnotation = Annotation.Root({
    companyName: Annotation<string>,
    companyDomain: Annotation<string>,
    companyInfo: Annotation<any>,
    currentStep: Annotation<string>,
    error: Annotation<string>,
    leads: Annotation<any[]>({
      default: () => [],
      reducer: (left: any[], right: any | any[]) => {
        if (Array.isArray(right)) {
          return [...left, ...right];
        }
        return [...left, right];
      },
    }),
    messages: Annotation<BaseMessage[]>({
      reducer: (left: BaseMessage[], right: BaseMessage | BaseMessage[]) => {
        if (Array.isArray(right)) {
          return left.concat(right);
        }
        return left.concat([right]);
      },
      default: () => [],
    }),
  });

  const workflow = new StateGraph(StateAnnotation);

  return workflow
    .addNode("process_query", processQuery)
    .addNode("enrich", enrichCompanyData)
    .addNode("search_managers", searchManagerLeads)
    .addNode("summarize", summarizeFindings)
    .addEdge(START, "process_query")
    .addEdge("process_query", "enrich")
    .addEdge("enrich", "search_managers")
    .addEdge("search_managers", "summarize")
    .addEdge("summarize", END)
    .compile();
}

// Main function to run the agent
async function processCompany(companyQuery: string): Promise<any> {
  try {
    if (!companyQuery || typeof companyQuery !== 'string' || companyQuery.trim().length === 0) {
      throw new Error("Company query is required and must be a non-empty string");
    }

    console.log(`Starting company enrichment for: ${companyQuery}`);
    const agent = await buildCompanyEnrichmentAgent();

    const initialState = {
      messages: [new HumanMessage(companyQuery.trim())],
      currentStep: "process_query",
      leads: [],
    };

    const result = await agent.invoke(initialState);

    if (result.error) {
      return {
        success: false,
        error: result.error,
        message: "Failed to process company information",
      };
    }

    // Return the final message (the summary) and the structured data
    return {
      success: true,
      summary: result.messages?.[result.messages.length - 1]?.content || "No summary available",
      companyDomain: result.companyDomain,
      companyData: result.companyInfo,
      leads: result.leads || [],
    };
  } catch (error) {
    console.error("Error in processCompany:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
      message: "Failed to process company information",
    };
  }
}

// Export for use in API server
module.exports = { processCompany };

// Example usage when running directly
if (require.main === module) {
  const testCompany = async () => {
    try {
      const result = await processCompany("Leads for company.com");
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error("Test failed:", error);
    }
  };

  testCompany();
}
