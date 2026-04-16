import * as SecureStore from "expo-secure-store";
import { getOrCreateDeviceId } from "../deviceId";

jest.mock("expo-secure-store");

const mockGet = SecureStore.getItemAsync as jest.Mock;
const mockSet = SecureStore.setItemAsync as jest.Mock;

describe("getOrCreateDeviceId", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns existing ID from SecureStore without generating a new one", async () => {
    mockGet.mockResolvedValueOnce("existing-id-123");
    const id = await getOrCreateDeviceId();
    expect(id).toBe("existing-id-123");
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("generates and stores a new UUID when none exists", async () => {
    mockGet.mockResolvedValueOnce(null);
    mockSet.mockResolvedValueOnce(undefined);
    const id = await getOrCreateDeviceId();
    // UUID v4 format: 8-4-4-4-12 hex chars
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(mockSet).toHaveBeenCalledWith("uiuc_bus_device_id", id);
  });
});
